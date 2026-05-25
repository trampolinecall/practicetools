<script lang="ts">
    // a few notes on terms used in the code:
    // - pulse: the steady beats that are played by the program at the requested tempo
    // - pulse gap: the amount of time in between two pulses based on the tempo, usually in ms
    // - note: a note played by the user
    // - measure: a group of pulses of the length requested (eg if the exercises is to play 3 notes in 2 pulses, a measure is a group of 2 pulses)
    // - measure length: the length of a measure, measured in pulses, or equivalently, the number of pulses in a measure
    // - measure time: the length of a measure in ms

    import { onMount } from 'svelte';

    let audioContext: AudioContext | undefined;

    // if a note is played within 30 ms of the end of the measure, consider it an early note in the next measure
    const nextMeasureMargin = 30;

    let tempo = $state(90);
    let measureLength = $state(1);
    let numSubdivisions = $state(3);
    let allowedError = $state(15);

    class Measure {
        readonly tempo: number; // tempo of pulses
        readonly length: number; // length of measure in pulses
        readonly start: number; // the start of the measure, recorded as ms returned by performance.now()
        readonly allowedError: number;
        readonly numSubdivisions: number; // expected number of subdivisions or notes
        notes: number[]; // the actual notes played by the user, recorded as ms returned by performance.now()
        score: number | null;

        constructor(tempo: number, length: number, start: number, allowedError: number, numSubdivisions: number, notes: number[]) {
            this.tempo = tempo;
            this.length = length;
            this.start = start;
            this.allowedError = allowedError;
            this.numSubdivisions = numSubdivisions;
            this.notes = $state(notes);
            this.score = $state(null);
        }

        pulseGap() {
            return 60000 / this.tempo;
        }

        idealNoteGap() {
            return this.time() / this.numSubdivisions;
        }

        // length of measure in ms
        time() {
            return this.pulseGap() * this.length;
        }

        calculateScore() {
            this.score = 0;

            let notes = this.notes.slice();

            // for each expected note, we find the closest played note and then add the difference between the two to the score if it falls outside of the acceptable amount of error
            for (let i = 0; i < this.numSubdivisions; ++i) {
                if (notes.length == 0) {
                    // if there were too few notes, make the score really high
                    this.score += 100;
                    break;
                }

                let expectedTime = (i / this.numSubdivisions) * this.time() + this.start;
                let diffs = notes.map((note) => Math.abs(note - expectedTime));
                let closestIndex = diffs.reduce((minInd, diff, curInd) => (diff < diffs[minInd] ? curInd : minInd), 0);
                let closestError = diffs[closestIndex];
                notes.splice(closestIndex, 1);

                if (closestError >= this.allowedError) {
                    this.score += closestError - this.allowedError;
                }
            }

            // for all of the leftover notes, add to the score how far off they were multiplied by 100 as extra penalty
            // because these are extra notes, don't skip the notes that were within the allowable error margin
            for (let note of notes) {
                this.score += Math.abs(this.calculateDiff(note)) * 100;
            }

            this.score = Math.round(this.score);
        }

        calculateDiff(note: number) {
            let closestExpectedNote = Math.round((note - this.start) / this.idealNoteGap()) * this.idealNoteGap() + this.start;
            let diff = note - closestExpectedNote;

            return diff;
        }
    }

    let playHistory: Measure[] = $state([]);

    function sleep(ms: number, signal?: AbortSignal) {
        return new Promise((resolve, reject) => {
            if (signal) {
                signal.throwIfAborted();
                signal.addEventListener(
                    'abort',
                    () => {
                        // Stop the main operation
                        // Reject the promise with the abort reason.
                        reject(signal.reason);
                    },
                    { once: true }
                );
            }
            setTimeout(resolve, ms);
        });
    }

    async function playBeat(freq: number) {
        if (audioContext) {
            let oscillator = new OscillatorNode(audioContext, { type: 'square', frequency: freq });
            oscillator.connect(audioContext.destination);

            oscillator.start();
            await sleep(50); // TODO: make a metronome click sound
            // TODO: need to have a more intense click sound to signal the start of a measure
            // TODO: put actual sounds for the metronome and the notes played instead of just beeps
            oscillator.stop();
        } else {
            console.warn('tried to play beat but there is no AudioContext');
        }
    }

    async function playFirstPulseBeat() {
        await playBeat(550);
    }
    async function playPulseBeat() {
        await playBeat(440);
    }
    async function playNoteBeat() {
        await playBeat(660);
    }

    async function exercise(tempo: number, measureLength: number, numSubdivisions: number, allowedError: number, signal: AbortSignal) {
        let nextMeasure: number[] | null = null;

        while (true) {
            signal.throwIfAborted();

            let pulseGap = 60000 / tempo; // also in ms

            let measureStart = performance.now(); // in ms
            let measure: Measure = new Measure(tempo, measureLength, measureStart, allowedError, numSubdivisions, nextMeasure || []);
            playHistory.unshift(measure);

            function recordPress(ev: Event) {
                playNoteBeat();
                measure.notes.push(performance.now());
            }

            document.addEventListener('mousedown', recordPress); // TODO: maybe only when pressing on a certain part of the screen because this also activates when you are trying to stop the exercise too
            document.addEventListener('keydown', recordPress); // TODO: maybe don't do every possible keypress

            try {
                for (let i = 0; i < measureLength; ++i) {
                    if (i == 0) {
                        playFirstPulseBeat();
                    } else {
                        playPulseBeat();
                    }
                    await sleep(pulseGap, signal);
                }
            } finally {
                // do not accidentally keep the event listeners if it is stopped during the wait
                document.removeEventListener('mousedown', recordPress);
                document.removeEventListener('keydown', recordPress);

                // but we also need to include all of this in the finally block so that if the measure is empty it will still get popped
                // if things get moved to the next measure, they will just get deleted because the exercise has ended and the loop will not run another time

                if (measure.notes.length > 0) {
                    let nextMeasureStart = measureStart + pulseGap * measureLength;
                    let lastInThisMeasureIndex = measure.notes.findLastIndex((note) => note < nextMeasureStart - nextMeasureMargin);
                    if (lastInThisMeasureIndex != undefined) {
                        let moveToNextMeasure = lastInThisMeasureIndex + 1;
                        nextMeasure = measure.notes.slice(moveToNextMeasure);
                        measure.notes = measure.notes.slice(0, moveToNextMeasure);
                    } else {
                        // all the notes are considered part of the next measure;
                        nextMeasure = measure.notes;
                        measure.notes = [];
                    }
                }

                measure.calculateScore();

                if (measure.notes.length == 0) {
                    playHistory.shift();
                }
                // TODO: put breaks when the parameters of the exercise change
            }
        }
    }

    let currentAbortController: AbortController | null;

    function exerciseIsRunning() {
        return currentAbortController != null;
    }

    function startExercise() {
        // start the exercise based on the current values in the global variables
        if (exerciseIsRunning()) {
            stopExercise();
        }

        currentAbortController = new AbortController();
        exercise(tempo, measureLength, numSubdivisions, allowedError, currentAbortController.signal).catch((err) => {
            if (err.name == 'AbortError') {
                // don't throw anything
            } else {
                throw err;
            }
        });
    }
    function stopExercise() {
        if (currentAbortController != null) {
            currentAbortController.abort();
            currentAbortController = null;
        }
    }
    function updateExercise() {
        // update the parameters of the exercise with the current requested values (that are in the global variables)
        // if it is not running, then there is nothing to update
        // startExercise will handle stopping first if needed
        if (exerciseIsRunning()) {
            startExercise();
        }
    }

    onMount(() => {
        audioContext = new window.AudioContext();
    });
</script>

<svelte:head>
    <title>Subdivision Practice</title>
</svelte:head>

<div>
    <h1>Subdivision Practice</h1>
    <p>
        This tool is meant to help practice even subdivisions. You will be given a pulse and must tap out even subdivisions in a certain number of pulses with either mouseclicks or keypresses. For
        example, if you choose 3 subdivisions within 2 pulses, you must tap out 3 even subdivisions in the time of 2 of the given pulses (like a hemiola). As another example, if you choose 5
        subdivisions in 1 pulse, you must tap out 5 even subdivision within each pulse (like playing quintuplets). The tool can score how accurate your rhythm is, with lower scores being better, and a
        perfect score being 0.
    </p>
</div>

<div>
    <p>
        <label style="text-wrap-mode: nowrap">Tempo: <input type="number" min="1" step="1" bind:value={tempo} onchange={updateExercise} /></label>
        <label style="text-wrap-mode: nowrap">Number of subdivisions: <input type="number" min="1" step="1" bind:value={numSubdivisions} onchange={updateExercise} /></label>
        <label style="text-wrap-mode: nowrap">Number of pulses: <input type="number" min="1" step="1" bind:value={measureLength} onchange={updateExercise} /></label>
        <label style="text-wrap-mode: nowrap">Allowed error (ms): <input type="number" min="1" step="1" bind:value={allowedError} onchange={updateExercise} /></label>

        <span style="text-wrap-mode: nowrap">
            <button class="danger lg" onclick={startExercise}>Start</button>
            <button class="danger lg" onclick={stopExercise}>Stop</button>
        </span>
    </p>
</div>

<div>
    {#each playHistory as measure, measureIndex}
        {#if measureIndex == 0 || playHistory[measureIndex - 1].tempo != measure.tempo || playHistory[measureIndex - 1].length != measure.length || playHistory[measureIndex - 1].allowedError != measure.allowedError || playHistory[measureIndex - 1].numSubdivisions != measure.numSubdivisions}
            <div class="measureSeparator">
                <p>{measure.numSubdivisions}:{measure.length} @ {measure.tempo} BPM, &plusmn; {measure.allowedError} ms</p>
            </div>
        {/if}
        <div class="historyRow">
            <div class="points">
                <!-- TODO: put a scale of time above the thing  -->
                {#each { length: measure.numSubdivisions }, idealNote}
                    <div
                        class="allowedErrorRange"
                        style="left: {(idealNote / measure.numSubdivisions - measure.allowedError / measure.time()) * 100}%; width: {((measure.allowedError * 2) / measure.time()) * 100}%"
                    ></div>
                {/each}

                {#each { length: measure.numSubdivisions }, idealNote}
                    <div class="point idealNote" style="position: absolute; left: calc({(idealNote / measure.numSubdivisions) * 100}% - 2px)"></div>
                {/each}

                {#each { length: measure.length }, pulse}
                    <div class="point pulse" style="position: absolute; left: calc({(pulse / measure.length) * 100}% - 2px)"></div>
                {/each}

                {#each measure.notes as note}
                    {@const diff = Math.round(measure.calculateDiff(note))}
                    <div style="height: 100%; position: absolute; left: calc({((note - measure.start) / measure.time()) * 100}% - 2px); display: flex; flex-flow: horizontal nowrap;">
                        <div class="point actualNote"></div>
                        <p class="diffLabel">{diff} ms</p>
                    </div>
                {/each}
            </div>
            <div class="judgement">
                {#if measure.score !== null}
                    <p class="judgement-text">Score: {measure.score}</p>
                {/if}
            </div>
        </div>
    {/each}
</div>

<style>
    .historyRow {
        position: relative;
        display: flex;
        flex-flow: row nowrap;
        align-items: stretch;
        height: 2em;
    }
    .points {
        position: relative;
        margin-left: 25px;
        margin-right: 25px;
        flex-grow: 1;
    }
    .judgement {
        flex-basis: 25%;
    }
    .judgement-text {
        margin-top: 0.2em;
        margin-bottom: 0.2em;
    }

    .diffLabel {
        font-size: 0.75em;
        text-wrap-mode: nowrap;
        margin: 0;
        padding: 0;
    }

    /* TODO: do not hardcode this width (also because i have to update the calculation for the positioning in the div too) */
    .point {
        width: 4px;
        height: 100%;
    }
    /* TODO: figure out nicer colors for these */
    /* TODO: explain what the colors mean */
    .actualNote {
        background: red;
    }
    .idealNote {
        background: blue;
    }
    .pulse {
        background: purple;
    }

    .allowedErrorRange {
        position: absolute;
        background: #0f08;
        height: 100%;
    }
</style>
