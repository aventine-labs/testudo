package engine

import (
	"context"
	"math"
	"sort"
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
	setupTGs      []*jmx.ThreadGroup
	normalTGs     []*jmx.ThreadGroup
	teardownTGs   []*jmx.ThreadGroup
	enabledTGs    []*jmx.ThreadGroup
}

// NewDriver creates an execution orchestrator.
func NewDriver(plan *jmx.TestPlan, opts jmx.ExecutionOptions) *Driver {
	var setupTGs, normalTGs, teardownTGs, enabledTGs []*jmx.ThreadGroup
	for _, tg := range plan.ThreadGroups {
		if tg.Enabled {
			enabledTGs = append(enabledTGs, tg)
			if tg.IsSetUp {
				setupTGs = append(setupTGs, tg)
			} else if tg.IsTearDown {
				teardownTGs = append(teardownTGs, tg)
			} else {
				normalTGs = append(normalTGs, tg)
			}
		}
	}

	totalNormalVUs := int64(0)
	maxRampSec := 0

	for _, tg := range normalTGs {
		threads := tg.NumThreads
		if threads <= 0 {
			threads = 1
		}
		if opts.OverrideVUs > 0 && len(normalTGs) == 1 {
			threads = opts.OverrideVUs
		}
		totalNormalVUs += int64(threads)
		if tg.RampTimeSec > maxRampSec {
			maxRampSec = tg.RampTimeSec
		}
	}

	if totalNormalVUs == 0 && len(normalTGs) > 0 {
		totalNormalVUs = 1
	} else if totalNormalVUs == 0 && len(enabledTGs) > 0 {
		totalNormalVUs = 1
	}

	initialVUs := totalNormalVUs
	if opts.OverrideVUs > 0 && len(normalTGs) != 1 {
		initialVUs = int64(opts.OverrideVUs)
	}

	rampRate := opts.RampRate
	if rampRate <= 0 {
		if maxRampSec > 0 && initialVUs > 0 {
			rate := int(float64(initialVUs)/float64(maxRampSec) + 0.5)
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
		setupTGs:      setupTGs,
		normalTGs:     normalTGs,
		teardownTGs:   teardownTGs,
		enabledTGs:    enabledTGs,
	}
}

// Run launches the test execution loop according to JMeter lifecycle:
// 1. setUp thread groups execute sequentially to completion
// 2. Standard thread groups execute concurrently respecting per-group ramp, delay, duration, loops
// 3. tearDown thread groups execute sequentially after standard thread groups complete
func (d *Driver) Run(ctx context.Context) error {
	// If no thread groups are enabled, exit immediately without executing any requests
	if len(d.enabledTGs) == 0 {
		close(d.ResultChan)
		if d.TransportPool != nil {
			d.TransportPool.CloseIdleConnections()
		}
		return nil
	}

	var cancel context.CancelFunc
	if d.Options.Duration > 0 {
		ctx, cancel = context.WithTimeout(ctx, d.Options.Duration)
		defer cancel()
	}

	// Telemetry background updater
	snapTicker := time.NewTicker(500 * time.Millisecond)
	defer snapTicker.Stop()
	snapCtx, snapCancel := context.WithCancel(context.Background())
	defer snapCancel()

	go func() {
		for {
			select {
			case <-snapCtx.Done():
				return
			case <-snapTicker.C:
				snap := d.Collector.Snapshot()
				d.Throttle.CheckAutoHunter(snap, d.Collector)
			}
		}
	}()

	// 1. Execute setUp Thread Groups sequentially to completion
	for _, tg := range d.setupTGs {
		select {
		case <-ctx.Done():
			break
		default:
			d.runSingleThreadGroup(ctx, tg)
		}
	}

	// 2. Execute Normal Thread Groups concurrently
	if len(d.normalTGs) > 0 {
		var normalWG sync.WaitGroup
		normalCtx, normalCancel := context.WithCancel(ctx)
		defer normalCancel()

		for _, tg := range d.normalTGs {
			normalWG.Add(1)
			go func(t *jmx.ThreadGroup) {
				defer normalWG.Done()
				d.runSingleThreadGroup(normalCtx, t)
			}(tg)
		}

		// Wait for all normal thread groups to complete, or context cancellation
		normalDone := make(chan struct{})
		go func() {
			normalWG.Wait()
			close(normalDone)
		}()

		select {
		case <-ctx.Done():
			d.drainWorkers()
			<-normalDone
		case <-normalDone:
		}
		normalCancel()
	}

	// 3. Execute tearDown Thread Groups sequentially after normal thread groups
	tearDownCtx := context.Background()
	for _, tg := range d.teardownTGs {
		d.runSingleThreadGroup(tearDownCtx, tg)
	}

	snapCancel()
	d.drainWorkers()
	close(d.ResultChan)
	if d.TransportPool != nil {
		d.TransportPool.CloseIdleConnections()
	}
	return nil
}

func (d *Driver) cancelWorkers(n int) {
	cancelled := 0
	for i := 0; i < numWorkerShards && cancelled < n; i++ {
		shard := d.shards[i]
		shard.Lock()
		for id, cancel := range shard.cancels {
			cancel()
			delete(shard.cancels, id)
			cancelled++
			if cancelled >= n {
				break
			}
		}
		shard.Unlock()
	}
}

func (d *Driver) getTGTarget(tg *jmx.ThreadGroup, globalTarget int64) int64 {
	if tg.IsSetUp || tg.IsTearDown {
		t := int64(tg.NumThreads)
		if t <= 0 {
			t = 1
		}
		return t
	}
	if len(d.normalTGs) <= 1 {
		return globalTarget
	}

	totalBase := int64(0)
	tgIdx := -1
	for idx, t := range d.normalTGs {
		if t == tg {
			tgIdx = idx
		}
		b := int64(t.NumThreads)
		if b <= 0 {
			b = 1
		}
		totalBase += b
	}

	if totalBase == 0 || tgIdx < 0 {
		return globalTarget
	}

	// Largest remainder method (Hamilton-Hare) to guarantee sum(allocated) == globalTarget
	allocated := make([]int64, len(d.normalTGs))
	var sumAllocated int64
	type remItem struct {
		idx int
		rem float64
	}
	rems := make([]remItem, len(d.normalTGs))

	for idx, t := range d.normalTGs {
		b := int64(t.NumThreads)
		if b <= 0 {
			b = 1
		}
		exact := float64(globalTarget) * float64(b) / float64(totalBase)
		floor := int64(math.Floor(exact))
		allocated[idx] = floor
		sumAllocated += floor
		rems[idx] = remItem{idx: idx, rem: exact - float64(floor)}
	}

	diff := int(globalTarget - sumAllocated)
	if diff > 0 {
		sort.Slice(rems, func(i, j int) bool {
			return rems[i].rem > rems[j].rem
		})
		for i := 0; i < diff && i < len(rems); i++ {
			allocated[rems[i].idx]++
		}
	}

	target := allocated[tgIdx]
	if target < 1 && globalTarget > 0 {
		target = 1
	}
	return target
}

func (d *Driver) runSingleThreadGroup(ctx context.Context, tg *jmx.ThreadGroup) {
	// 1. Startup Delay
	if tg.StartupDelaySec > 0 {
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Duration(tg.StartupDelaySec) * time.Second):
		}
	}

	// 2. Per-thread-group duration timeout if scheduler enabled
	tgCtx := ctx
	if tg.Scheduler && tg.DurationSec > 0 {
		var cancel context.CancelFunc
		tgCtx, cancel = context.WithTimeout(ctx, time.Duration(tg.DurationSec)*time.Second)
		defer cancel()
	}

	threads := tg.NumThreads
	if threads <= 0 {
		threads = 1
	}
	if d.Options.OverrideVUs > 0 && !tg.IsSetUp && !tg.IsTearDown && len(d.normalTGs) == 1 {
		threads = d.Options.OverrideVUs
	}

	var rampInterval time.Duration
	if tg.RampTimeSec > 0 && threads > 1 {
		rampInterval = time.Duration(float64(tg.RampTimeSec) / float64(threads) * float64(time.Second))
	}

	// Case A: Finite loop count execution (JMeter loop count honored, no respawning)
	if tg.LoopCount > 0 {
		var tgWG sync.WaitGroup
		tgWG.Add(threads)
		for i := 0; i < threads; i++ {
			select {
			case <-tgCtx.Done():
				for j := i; j < threads; j++ {
					tgWG.Done()
				}
				return
			default:
			}

			d.spawnWorkerForTG(tgCtx, tg, tgWG.Done)

			if rampInterval > 0 && i < threads-1 {
				select {
				case <-tgCtx.Done():
					for j := i + 1; j < threads; j++ {
						tgWG.Done()
					}
					return
				case <-time.After(rampInterval):
				}
			}
		}
		tgWG.Wait()
		return
	}

	// Case B: Continuous execution with dynamic live VU scaling (Flight Deck & Knee Hunter)
	var tgWG sync.WaitGroup
	var tgActive int64
	var tgMu sync.Mutex
	tgCancels := make(map[int]context.CancelFunc)

	cancelTGWorkers := func(n int) {
		tgMu.Lock()
		defer tgMu.Unlock()
		cancelled := 0
		for id, cancel := range tgCancels {
			cancel()
			delete(tgCancels, id)
			cancelled++
			if cancelled >= n {
				break
			}
		}
	}

	spawnWorker := func() {
		tgWG.Add(1)
		atomic.AddInt64(&tgActive, 1)
		d.spawnWorkerForTGWithRegistry(tgCtx, tg, func() {
			atomic.AddInt64(&tgActive, -1)
			tgWG.Done()
		}, func(id int, cancel context.CancelFunc) {
			tgMu.Lock()
			tgCancels[id] = cancel
			tgMu.Unlock()
		}, func(id int) {
			tgMu.Lock()
			delete(tgCancels, id)
			tgMu.Unlock()
		})
	}

	for i := 0; i < threads; i++ {
		select {
		case <-tgCtx.Done():
			goto WAIT
		default:
		}
		spawnWorker()
		if rampInterval > 0 && i < threads-1 {
			select {
			case <-tgCtx.Done():
				goto WAIT
			case <-time.After(rampInterval):
			}
		}
	}

	// If this is setUp or tearDown, it does not participate in continuous live throttle scaling;
	// it simply runs until tgCtx completes.
	if tg.IsSetUp || tg.IsTearDown {
		<-tgCtx.Done()
		goto WAIT
	}

	{
		ticker := time.NewTicker(100 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-tgCtx.Done():
				goto WAIT
			case <-ticker.C:
				globalTarget := d.Throttle.GetTargetVUs()
				d.Collector.SetTargetVUs(globalTarget)
				target := d.getTGTarget(tg, globalTarget)
				curr := atomic.LoadInt64(&tgActive)
				if curr < target {
					diff := int(target - curr)
					if diff > d.Throttle.rampRateVUsSec && d.Throttle.rampRateVUsSec > 0 {
						diff = d.Throttle.rampRateVUsSec
					}
					for i := 0; i < diff; i++ {
						spawnWorker()
					}
				} else if curr > target {
					excess := int(curr - target)
					cancelTGWorkers(excess)
				}
			}
		}
	}

WAIT:
	tgWG.Wait()
}

func (d *Driver) spawnWorkerForTG(parentCtx context.Context, tg *jmx.ThreadGroup, onDone func()) {
	d.spawnWorkerForTGWithRegistry(parentCtx, tg, onDone, nil, nil)
}

func (d *Driver) spawnWorkerForTGWithRegistry(
	parentCtx context.Context,
	tg *jmx.ThreadGroup,
	onDone func(),
	onRegister func(int, context.CancelFunc),
	onUnregister func(int),
) {
	id := int(atomic.AddInt64(&d.nextID, 1))
	ctx, cancel := context.WithCancel(parentCtx)

	shard := d.shards[id%numWorkerShards]
	shard.Lock()
	shard.cancels[id] = cancel
	shard.Unlock()

	if onRegister != nil {
		onRegister(id, cancel)
	}

	atomic.AddInt64(&d.activeCount, 1)
	d.Collector.SetActiveVUs(atomic.LoadInt64(&d.activeCount))

	go func() {
		defer func() {
			shard.Lock()
			delete(shard.cancels, id)
			shard.Unlock()
			if onUnregister != nil {
				onUnregister(id)
			}
			atomic.AddInt64(&d.activeCount, -1)
			d.Collector.SetActiveVUs(atomic.LoadInt64(&d.activeCount))
			if onDone != nil {
				onDone()
			}
		}()

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
