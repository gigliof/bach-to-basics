const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({ window, resources, backendURL, token }) => {
  const results = new Proxy({}, { set(target, key, value) {
    target[key] = value;
    fs.writeFileSync(process.env.BACH_SMOKE_OUTPUT + '.progress', JSON.stringify(target, null, 2));
    return true;
  } });
  const js = (source) => window.webContents.executeJavaScript(source, true);
  const poll = async (source, timeout = 30000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await js(source)) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out: ${source}`);
  };
  if (process.env.BACH_EXPECT_RESTORE) {
    await poll(`document.querySelector('[aria-label=\"Current song\"]')?.textContent === 'MIDI Check' && document.querySelector('[aria-label="Open song library"]')?.textContent.includes('(2)')`);
    results.lastSongRestoredAfterAppRelaunch = true;
  }
  if (process.env.BACH_CHECK_MIDI_MENU) {
    const open = async () => {
      await js(`document.querySelector('[aria-label="Choose MIDI instrument"]').click()`);
      await poll(`document.querySelector('#midi-input-picker') !== null`);
    };
    await poll(`document.querySelector('[aria-label="Choose MIDI instrument"]') !== null`);
    await open();
    if (process.env.BACH_MIDI_EMPTY) {
      assert.equal(await js(`document.querySelector('.midi-empty-state strong').textContent`), 'No instruments detected');
      assert.equal(await js(`document.querySelector('.midi-disconnect') === null`), true);
      results.emptyStateExplainsConnection = true;
    } else {
      await poll(`document.querySelectorAll('.midi-device-row').length >= 2`);
      assert.equal(await js(`document.querySelectorAll('.midi-device-row[aria-pressed="true"]').length`), 1);
      assert.equal(await js(`document.querySelector('.midi-empty-state') === null`), true);
      results.selectedInstrumentClearlyShown = true;
      await js(`Array.from(document.querySelectorAll('.midi-device-row')).find(row => row.getAttribute('aria-pressed') === 'false').click()`);
      await poll(`document.querySelector('#midi-input-picker') === null`);
      await open();
      assert.equal(await js(`document.activeElement.getAttribute('aria-pressed')`), 'true');
      await js(`document.querySelector('.midi-disconnect').click()`);
      await open();
      assert.equal(await js(`document.querySelector('.midi-device-row[aria-pressed="true"]') === null`), true);
      assert.equal(await js(`document.querySelector('.midi-disconnect') === null`), true);
      await js(`document.querySelector('.midi-device-row').click()`);
      await open();
      results.switchDisconnectAndReconnectWork = true;
    }
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    await poll(`document.querySelector('#midi-input-picker') === null`);
    assert.equal(await js(`document.activeElement.getAttribute('aria-label')`), 'Choose MIDI instrument');
    results.escapeReturnsFocus = true;
    await open();
    await new Promise(resolve => setTimeout(resolve, 200));
    const rect = await js(`(() => { const r = document.querySelector('#midi-input-picker').getBoundingClientRect(); return { x: Math.floor(r.x - 18), y: Math.floor(r.y - 48), width: Math.ceil(r.width + 36), height: Math.ceil(r.height + 70) }; })()`);
    fs.writeFileSync(process.env.BACH_SMOKE_OUTPUT + '.png', (await window.webContents.capturePage(rect)).toPNG());
    await js(`document.querySelector('[aria-label="Choose MIDI instrument"]').click(); document.querySelector('[aria-label="Switch to dark mode"]')?.click()`);
    await open();
    await new Promise(resolve => setTimeout(resolve, 200));
    fs.writeFileSync(process.env.BACH_SMOKE_OUTPUT + '.dark.png', (await window.webContents.capturePage(rect)).toPNG());
    await js(`document.querySelector('[aria-label="Choose MIDI instrument"]').click(); document.querySelector('[aria-label="Switch to light mode"]')?.click()`);
    fs.writeFileSync(process.env.BACH_SMOKE_OUTPUT, JSON.stringify(results, null, 2));
    return;
  }
  if (process.env.BACH_CHECK_KEYBOARD) {
    await poll(`document.querySelector('#piano-keyboard canvas')?.width > 0`);
    const height = () => js(`document.querySelector('#piano-keyboard').getBoundingClientRect().height`);
    const key = async (value) => {
      await js(`document.querySelector('[aria-label="Resize keyboard height"]').focus()`);
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: value });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: value });
      await new Promise(resolve => setTimeout(resolve, 150));
    };
    if (process.env.BACH_KEYBOARD_RESTORE) {
      assert.equal(await height(), 200);
      results.keyboardHeightSurvivesFullRelaunch = true;
    } else {
      const drag = async (delta) => {
        const point = await js(`(() => { const r = document.querySelector('[aria-label="Resize keyboard height"]').getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })()`);
        window.webContents.sendInputEvent({ type: 'mouseMove', ...point });
        window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
        window.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y - delta });
        window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: point.x, y: point.y - delta });
        await new Promise(resolve => setTimeout(resolve, 300));
      };
      await key('Home');
      assert.equal(await height(), 80);
      await drag(100);
      assert.equal(await height(), 180);
      results.realPointerDragResizesKeyboard = true;
      await drag(300);
      assert.equal(await height(), await js(`Math.floor(innerHeight/3)`));
      results.dragCappedAtOneThird = true;
      const oldBounds = window.getBounds();
      window.setSize(oldBounds.width, 640);
      await new Promise(resolve => setTimeout(resolve, 500));
      assert.ok(await height() <= await js(`innerHeight/3`));
      results.smallerWindowReappliesCap = true;
      window.setBounds(oldBounds);
      await new Promise(resolve => setTimeout(resolve, 300));
      await key('Home');
      await key('Up');
      assert.equal(await height(), 85);
      await key('End');
      assert.equal(await height(), await js(`Math.floor(innerHeight/3)`));
      results.keyboardAccessibleResizing = true;
      await key('Home');
      await drag(120);
      assert.equal(await height(), 200);
      assert.equal(await js(`JSON.parse(localStorage.getItem('bach-to-basics-preferences-v1')).settings.keyboardHeight`), 200);
      const dimensions = await js(`(() => { const canvas = document.querySelector('#piano-keyboard canvas'); return { pixels: canvas.height, css: canvas.getBoundingClientRect().height, ratio: devicePixelRatio }; })()`);
      assert.ok(Math.abs(dimensions.pixels - dimensions.css * dimensions.ratio) <= 2);
      results.canvasRedrawnAtAdjustedHeight = true;
      const edge = await js(`(() => { const container = document.querySelector('#piano-keyboard'); const handle = container.querySelector('[role="separator"]'); const canvas = container.querySelector('canvas'); return { background: getComputedStyle(handle).backgroundColor, gripCount: handle.children.length, gap: canvas.getBoundingClientRect().top - container.getBoundingClientRect().top, canvasHeight: canvas.getBoundingClientRect().height, containerHeight: container.getBoundingClientRect().height }; })()`);
      assert.equal(edge.background, 'rgba(0, 0, 0, 0)');
      assert.equal(edge.gripCount, 0);
      assert.equal(edge.gap, 0);
      assert.equal(edge.canvasHeight, edge.containerHeight);
      results.seamlessKeyboardEdgeWithoutBar = true;
      await js(`document.activeElement.blur()`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    fs.writeFileSync(process.env.BACH_SMOKE_OUTPUT + '.png', (await window.webContents.capturePage()).toPNG());
    fs.writeFileSync(process.env.BACH_SMOKE_OUTPUT, JSON.stringify(results, null, 2));
    return;
  }
  if (process.env.BACH_CHECK_PREFERENCES) {
    await poll(`document.querySelector('[aria-label="Play"]')?.disabled === false`);
    assert.equal(await js(`document.querySelector('[aria-label="Wait mode"]').getAttribute('aria-pressed')`), 'true');
    assert.equal(await js(`document.querySelector('[aria-label="Unmute right hand"]') !== null`), true);
    assert.equal(await js(`document.querySelector('button[aria-label="Playback speed"]').textContent.includes('75%')`), true);
    assert.equal(await js(`JSON.parse(localStorage.getItem('bach-to-basics-preferences-v1')).settings.layoutMode`), 'all');
    await js(`document.querySelector('[aria-label="Adjust hand volumes"]').click()`);
    assert.equal(await js(`document.querySelector('[aria-label="Link hand volumes"]').getAttribute('aria-pressed')`), 'false');
    assert.equal(await js(`document.querySelector('input[aria-label="Left hand volume slider"]').value`), '0.35');
    assert.equal(await js(`document.querySelector('input[aria-label="Right hand volume slider"]').value`), '0.65');
    await js(`document.querySelector('[aria-label="Close hand volumes"]').click()`);
    await js(`document.querySelector('button[aria-label="Adjust loop range"]').click()`);
    assert.equal(await js(`document.querySelector('input[aria-label="Loop start"]').value`), '0.3');
    assert.equal(await js(`document.querySelector('input[aria-label="Loop end"]').value`), '1.8');
    results.preferencesAndSongLoopSurviveFullRelaunch = true;
    results.playbackRestoredStopped = true;
    fs.writeFileSync(process.env.BACH_SMOKE_OUTPUT, JSON.stringify(results, null, 2));
    return;
  }
  assert.equal((await fetch(`${backendURL}/health`)).status, 403);
  results.backendRejectsUnauthenticatedRequests = true;
  assert.equal(await js(`fetch('/api/health').then(r => r.json()).then(j => j.status)`), 'ok');
  results.rendererBackendConnection = true;
  assert.equal(await js(`typeof require`), 'undefined');
  results.rendererIsolated = true;
  assert.equal(await js(`navigator.requestMIDIAccess().then(() => true)`), true);
  results.webMidiAccess = true;
  const midiInputs = await js(`navigator.requestMIDIAccess().then(access => Array.from(access.inputs.values()).filter(input => input.state === 'connected').map(input => input.name))`);
  results.availableMidiInputs = midiInputs;
  if (midiInputs.length) {
    await poll(`Array.from(document.querySelectorAll('button')).some(button => button.title === ${JSON.stringify('Connected: ')} + ${JSON.stringify(midiInputs[0])})`);
    results.firstAvailableMidiInputAutoSelected = true;
  }

  const xml = `<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>Desktop Check</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction><sound tempo="90"/></direction><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note><note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note><note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note><note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note></measure></part></score-partwise>`;
  const form = new FormData();
  form.append('file', new Blob([xml]), 'Desktop Check.musicxml');
  const midiResponse = await fetch(`${backendURL}/transcribe/musicxml2midi`, { method: 'POST', headers: { 'X-API-Key': token }, body: form });
  assert.equal(midiResponse.status, 200, await midiResponse.clone().text());
  const midi = Buffer.from(await midiResponse.arrayBuffer());
  assert.equal(midi.subarray(0, 4).toString(), 'MThd');
  results.musicXmlToMidi = true;
  const midiForm = new FormData();
  midiForm.append('file', new Blob([midi]), 'Desktop Check.mid');
  const xmlResponse = await fetch(`${backendURL}/transcribe/midi2musicxml`, { method: 'POST', headers: { 'X-API-Key': token }, body: midiForm });
  assert.equal(xmlResponse.status, 200, await xmlResponse.clone().text());
  assert.match((await xmlResponse.json()).musicxml, /score-partwise/);
  results.midiToMusicXml = true;
  const fingering = await fetch(`${backendURL}/fingering/generate`, { method: 'POST', headers: { 'X-API-Key': token, 'Content-Type': 'application/json' }, body: JSON.stringify({ musicxml: xml }) });
  assert.equal(fingering.status, 200, await fingering.clone().text());
  assert.match((await fingering.json()).musicxml, /fingering/);
  results.fingering = true;

  window.webContents.send('open-music-file', { name: 'Desktop Check.musicxml', bytes: Buffer.from(xml) });
  await poll(`document.querySelector('[aria-label=\"Current song\"]')?.textContent === 'Desktop Check'`);
  await js(`document.querySelector('[title="Show all views at once"]').click()`);
  await js(`document.querySelector('[aria-label="Close settings"]')?.click()`);
  await poll(`document.querySelector('.at-surface svg, .at-surface canvas') !== null`);
  await poll(`document.querySelector('[aria-label="Play"]')?.disabled === false`);
  results.desktopMusicXmlImportAndSheetRendering = true;
  await js(`document.querySelector('[aria-label="Play"]').click()`);
  await poll(`document.querySelector('[title="Pause"]') !== null`, 60000);
  results.playbackStarted = true;
  await js(`document.querySelector('[title="Stop and return to start"]').click()`);
  window.webContents.send('open-music-file', { name: 'MIDI Check.mid', bytes: midi });
  await poll(`document.querySelector('[aria-label=\"Current song\"]')?.textContent === 'MIDI Check' && document.querySelector('[aria-label="Play"]')?.disabled === false`);
  results.desktopMidiImport = true;
  await poll(`document.querySelector('[aria-label="Open song library"]')?.textContent.includes('(2)')`);
  window.webContents.send('open-music-file', { name: 'MIDI Check.mid', bytes: midi });
  await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.equal(await js(`document.querySelector('[aria-label="Open song library"]').textContent.includes('(2)')`), true);
  results.reimportDoesNotDuplicateSongs = true;
  await js(`document.querySelector('[aria-label="Open song library"]').click()`);
  await poll(`document.querySelector('dialog[open] [aria-label="Open song Desktop Check.musicxml"]') !== null`);
  await js(`document.querySelector('[aria-label="Open song Desktop Check.musicxml"]').click()`);
  await poll(`!document.querySelector('dialog[open]') && document.querySelector('[aria-label=\"Current song\"]')?.textContent === 'Desktop Check'`);
  results.savedSongSwitching = true;
  await window.webContents.reload();
  await new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
  await poll(`document.querySelector('[aria-label=\"Current song\"]')?.textContent === 'Desktop Check' && document.querySelector('[aria-label="Play"]')?.disabled === false`);
  results.libraryAndLastSongSurviveReload = true;
  await js(`document.querySelector('[aria-label="Open song library"]').click()`);
  await js(`document.querySelector('[aria-label="Open song MIDI Check.mid"]').click()`);
  await poll(`!document.querySelector('dialog[open]') && document.querySelector('[aria-label=\"Current song\"]')?.textContent === 'MIDI Check'`);
  await js(`document.querySelector('button[aria-label="Adjust loop range"]').click()`);
  await poll(`document.querySelector('input[aria-label="Loop start"]') !== null`);
  const setRange = async (label, value) => js(`(() => {
    const input = document.querySelector('input[aria-label=${JSON.stringify(label)}]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${value});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await setRange('Loop start', .2);
  await setRange('Loop end', .8);
  assert.equal(await js(`document.querySelector('[aria-label="Loop start time"]').textContent`), '0:00.2');
  assert.equal(await js(`document.querySelector('[aria-label="Loop end time"]').textContent`), '0:00.8');
  await js(`document.querySelector('input[aria-label="Loop start"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`);
  assert.equal(await js(`document.querySelector('[aria-label="Loop start time"]').textContent`), '0:00.3');
  results.loopSliderAndKeyboardAdjustments = true;
  await setRange('Loop start', 2);
  assert.equal(await js(`document.querySelector('[aria-label="Loop start time"]').textContent`), '0:00.7');
  await setRange('Loop start', .2);
  results.loopHandlesCannotCross = true;
  await js(`document.querySelector('[aria-label="Play"]').click()`);
  await poll(`document.querySelector('[title="Pause"]') !== null`);
  await new Promise((resolve) => setTimeout(resolve, 3500));
  assert.equal(await js(`document.querySelector('[title="Pause"]') !== null`), true);
  results.shortLoopRepeatsPastSongDuration = true;
  await js(`document.querySelector('[title="Stop and return to start"]').click()`);
  await js(`Array.from(document.querySelectorAll('.loop-editor button')).find(b => b.textContent === 'Whole song').click()`);
  assert.equal(await js(`Number(document.querySelector('input[aria-label="Loop start"]').value)`), 0);
  assert.equal(await js(`document.querySelector('input[aria-label="Loop end"]').value === document.querySelector('input[aria-label="Loop end"]').max`), true);
  await js(`Array.from(document.querySelectorAll('.loop-editor button')).find(b => b.textContent === 'Turn loop off').click()`);
  assert.equal(await js(`document.querySelector('button[aria-label="Adjust loop range"]').textContent.includes('Loop')`), true);
  results.wholeSongAndDisableLoop = true;
  await js(`document.querySelector('button[aria-label="Adjust loop range"]').click()`);
  await setRange('Loop start', .3);
  await setRange('Loop end', 1.8);
  await js(`document.querySelector('[aria-label="Close loop editor"]').click()`);
  await js(`document.querySelector('[aria-label="Adjust hand volumes"]').click()`);
  await poll(`document.querySelector('input[aria-label="Left hand volume slider"]') !== null`);
  await setRange('Left hand volume slider', .4);
  assert.equal(await js(`document.querySelector('input[aria-label="Right hand volume slider"]').value`), '0.4');
  assert.equal(await js(`document.querySelector('input[aria-label="Left hand volume"]').value`), '0.4');
  assert.equal(await js(`document.querySelector('input[aria-label="Right hand volume"]').value`), '0.4');
  results.linkedHandVolumesAndSettingsSync = true;
  await js(`document.querySelector('[aria-label="Link hand volumes"]').click()`);
  await setRange('Left hand volume slider', .2);
  assert.equal(await js(`document.querySelector('input[aria-label="Left hand volume slider"]').value`), '0.2');
  assert.equal(await js(`document.querySelector('input[aria-label="Right hand volume slider"]').value`), '0.4');
  results.independentHandVolumes = true;
  await js(`document.querySelector('[aria-label="Mute right hand"]').click()`);
  assert.equal(await js(`document.querySelector('[aria-label="Unmute right hand"]') !== null`), true);
  await setRange('Right hand volume slider', .5);
  assert.equal(await js(`document.querySelector('[aria-label="Unmute right hand"]') !== null`), true);
  results.volumeAdjustmentPreservesMute = true;
  await js(`document.querySelector('[aria-label="Unmute right hand"]').click()`);
  await js(`document.querySelector('[aria-label="Link hand volumes"]').click()`);
  await setRange('Right hand volume slider', .65);
  const vertical = await js(`(() => { const r = document.querySelector('input[aria-label="Left hand volume slider"]').getBoundingClientRect(); return r.height > r.width * 3; })()`);
  assert.equal(vertical, true);
  results.handVolumeSlidersAreVertical = true;
  await js(`document.querySelector('[aria-label="Link hand volumes"]').click()`);
  await setRange('Left hand volume slider', .35);
  await js(`document.querySelector('[aria-label="Mute right hand"]').click()`);
  await js(`document.querySelector('[aria-label="Wait mode"]').click()`);
  await js(`document.querySelector('button[aria-label="Playback speed"]').click()`);
  await setRange('Playback speed', 75);
  results.preferencesAdjustedForRelaunch = true;
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const screenshot = await window.webContents.capturePage();
  fs.writeFileSync(process.env.BACH_SMOKE_OUTPUT + '.png', screenshot.toPNG());
  results.windowTitle = window.getTitle();
  results.resourcesInsideApp = resources.includes('.app/Contents/Resources');
  results.bundleDemoPresent = fs.existsSync(path.join(resources, 'frontend/demo.mid'));
  fs.writeFileSync(process.env.BACH_SMOKE_OUTPUT, JSON.stringify(results, null, 2));
};
