package engine

import (
	"context"
	"sync"
	"sync/atomic"
	"time"

	"aventinelabs.com/testudo-jmx/pkg/jmx"
	"aventinelabs.com/testudo-jmx/pkg/transport"
)

const numWorkerShards = 16

type workerShard struct {
	sync.Mutex
	cancels map[int]context.CancelFunc
}

func newWorkerShard() *workerShard {
	return &workerShard{
		cancels: make(map[int]context.CancelFunc),
	}
}

// Driver coordinates virtual user worker goroutines, dynamic scaling, and plan lifecycle.
type Driver struct {
	Plan          *jmx.TestPlan
	Options       jmx.ExecutionOptions
	Collector     *Collector
	Throttle      *Throttle
	TransportCfg  transport.TransportConfig
	TransportPool *transport.TransportPool
	ResultChan    chan *transport.SampleResult
	activeCount   int64
	shards        [numWorkerShards]*workerShard
	nextID        int64
}

// NewDriver creates an execution orchestrator.
func NewDriver(plan *jmx.TestPlan, opts jmx.ExecutionOptions) *Driver {
	initialVUs := int64(1)
	if opts.OverrideVUs > 0 {
		initialVUs = int64(opts.OverrideVUs)
	} else if len(plan.ThreadGroups) > 0 && plan.ThreadGroups[0].NumThreads > 0 {
		initialVUs = int64(plan.ThreadGroups[0].NumThreads)
	}

	rampRate := opts.RampRate
	if rampRate <= 0 {
		if len(plan.ThreadGroups) > 0 && plan.ThreadGroups[0].RampTimeSec > 0 {
			rampSec := plan.ThreadGroups[0].RampTimeSec
			rate := int(float64(initialVUs)/float64(rampSec) + 0.5)
			if rate < 1 {
				rate = 1
			}
			rampRate = rate
		} else {
			rampRate = 10 // default 10 VUs/sec
		}
	}

	tcfg := transport.DefaultTransportConfig()
	tcfg.KeepAliveMode = opts.KeepAliveMode
	tcfg.RecycleOnIter = opts.RecycleOnIter

	collector := NewCollector(initialVUs)
	throttle := NewThrottle(initialVUs, rampRate, opts.AutoStepHunter)

	shards := [numWorkerShards]*workerShard{}
	for i := 0; i < numWorkerShards; i++ {
		shards[i] = newWorkerShard()
	}

	tpool := transport.NewTransportPool(tcfg, 16)

	return &Driver{
		Plan:          plan,
		Options:       opts,
		Collector:     collector,
		Throttle:      throttle,
		TransportCfg:  tcfg,
		TransportPool: tpool,
		ResultChan:    make(chan *transport.SampleResult, 10000),
		shards:        shards,
	}
}

// Run launches the test execution loop until duration expires or context cancels.
func (d *Driver) Run(ctx context.Context) error {
	var cancel context.CancelFunc
	if d.Options.Duration > 0 {
		ctx, cancel = context.WithTimeout(ctx, d.Options.Duration)
		defer cancel()
	}

	// Dynamic concurrency reconciliation loop (1-second tick matching rampRateVUsSec)
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	// Snapshot telemetry periodic loop
	snapTicker := time.NewTicker(500 * time.Millisecond)
	defer snapTicker.Stop()

	var wg sync.WaitGroup

	for {
		select {
		case <-ctx.Done():
			d.drainWorkers()
			wg.Wait()
			close(d.ResultChan)
			if d.TransportPool != nil {
				d.TransportPool.CloseIdleConnections()
			}
			return nil

		case <-snapTicker.C:
			snap := d.Collector.Snapshot()
			d.Throttle.CheckAutoHunter(snap, d.Collector)

		case <-ticker.C:
			target := d.Throttle.GetTargetVUs()
			d.Collector.SetTargetVUs(target)
			curr := atomic.LoadInt64(&d.activeCount)

			if curr < target {
				// Ramp up by batch
				batch := int(target - curr)
				if batch > d.Throttle.rampRateVUsSec {
					batch = d.Throttle.rampRateVUsSec
				}
				for i := 0; i < batch; i++ {
					wg.Add(1)
					d.spawnWorker(ctx, &wg)
				}
			} else if curr > target {
				// Prune excess workers
				excess := int(curr - target)
				d.pruneWorkers(excess)
			}
		}
	}
}

func (d *Driver) spawnWorker(parentCtx context.Context, wg *sync.WaitGroup) {
	id := int(atomic.AddInt64(&d.nextID, 1))
	ctx, cancel := context.WithCancel(parentCtx)

	shard := d.shards[id%numWorkerShards]
	shard.Lock()
	shard.cancels[id] = cancel
	shard.Unlock()

	atomic.AddInt64(&d.activeCount, 1)
	d.Collector.SetActiveVUs(atomic.LoadInt64(&d.activeCount))

	go func() {
		defer func() {
			shard.Lock()
			delete(shard.cancels, id)
			shard.Unlock()
			atomic.AddInt64(&d.activeCount, -1)
			d.Collector.SetActiveVUs(atomic.LoadInt64(&d.activeCount))
			wg.Done()
		}()

		tg := d.Plan.ThreadGroups[0]
		tr := d.TransportPool.Next()
		session := NewUserSessionWithTransport(id, tg, d.Plan, d.Collector, d.ResultChan, d.TransportCfg, tr)
		session.DecomposeRedirects = d.Options.DecomposeRedirects

		loops := tg.LoopCount
		currentLoop := 0

		for {
			select {
			case <-ctx.Done():
				return
			default:
			}

			if loops > 0 && currentLoop >= loops {
				return
			}

			err := session.ExecuteIteration(ctx, tg.Samplers, d.Plan.GlobalHeaders)
			if err != nil {
				return
			}
			currentLoop++
		}
	}()
}

func (d *Driver) pruneWorkers(count int) {
	pruned := 0
	for i := 0; i < numWorkerShards && pruned < count; i++ {
		shard := d.shards[i]
		shard.Lock()
		for id, cancel := range shard.cancels {
			cancel()
			delete(shard.cancels, id)
			pruned++
			if pruned >= count {
				break
			}
		}
		shard.Unlock()
	}
}

func (d *Driver) drainWorkers() {
	for i := 0; i < numWorkerShards; i++ {
		shard := d.shards[i]
		shard.Lock()
		for id, cancel := range shard.cancels {
			cancel()
			delete(shard.cancels, id)
		}
		shard.Unlock()
	}
}
