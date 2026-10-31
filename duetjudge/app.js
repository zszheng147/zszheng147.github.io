(() => {
  'use strict';

  // Use the repository viewer for PDFs on the sandboxed anonymous host.
  const anonymousPage = location.hostname === 'anonymous.4open.science'
    ? location.pathname.match(/^\/w\/([^/]+)\//)
    : null;
  if (anonymousPage) {
    for (const link of document.querySelectorAll('[data-original-pdf]')) {
      link.href = `/r/${anonymousPage[1]}/${link.getAttribute('href')}`;
      link.removeAttribute('target');
      link.textContent = 'View original PDF';
    }
  }

  const samples = Array.isArray(window.DUET_SAMPLES) ? window.DUET_SAMPLES : [];
  const waveforms = window.DUET_WAVEFORMS || {};
  const players = [...document.querySelectorAll('audio')];
  const pendingAudio = new Map();
  const audioBundles = new Map();
  const loadAudioBundle = (source) => {
    if (!audioBundles.has(source)) {
      audioBundles.set(source, new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = source;
        script.onload = resolve;
        script.onerror = () => reject(new Error('Audio data could not be loaded'));
        document.head.append(script);
      }));
    }
    return audioBundles.get(source);
  };
  const textField = (value) => typeof value === 'string' ? value.trim() : '';
  const formatTime = (value) => {
    const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  };
  let waveformIndex = 0;

  for (const panel of document.querySelectorAll('[data-sample]')) {
    const sample = samples.find((entry) => entry && entry.id === panel.dataset.sample);
    if (!sample) continue;
    const caption = textField(sample.caption);
    if (caption) panel.querySelector('[data-caption]').textContent = caption;

    for (const row of panel.querySelectorAll('[data-audio-slot]')) {
      const source = textField(sample[row.dataset.audioSlot]);
      if (!source) continue;

      const audio = row.querySelector('audio');
      const controls = row.querySelector('.compact-player');
      const button = row.querySelector('.play-button');
      const seek = row.querySelector('.seek-input');
      const timeline = row.querySelector('.seek-control');
      const placeholder = row.querySelector('.audio-placeholder');
      const status = row.querySelector('[data-audio-status]');
      const label = audio.getAttribute('aria-label');
      const clipId = `wave-progress-${waveformIndex++}`;
      const peaks = waveforms[source];
      // A plain progress track remains usable if a new clip has no waveform yet.
      const bars = Array.isArray(peaks) && peaks.length
        ? peaks.map((peak, index) => {
          const height = 2 + 24 * Math.max(0, Math.min(1, Number(peak) || 0));
          return `<rect x="${index * 192 / peaks.length + 1}" y="${(28 - height) / 2}" width="${Math.max(1, 192 / peaks.length - 2)}" height="${height}" rx="1"/>`;
        }).join('')
        : '<rect x="0" y="12" width="192" height="4" rx="2"/>';
      row.querySelector('.waveform').innerHTML = `<svg viewBox="0 0 192 28" preserveAspectRatio="none"><defs><clipPath id="${clipId}"><rect class="progress-clip" width="0" height="28"/></clipPath></defs><g class="wave-background">${bars}</g><g class="wave-played" clip-path="url(#${clipId})">${bars}</g></svg>`;
      const clip = row.querySelector('.progress-clip');
      const current = row.querySelector('[data-current]');
      const duration = row.querySelector('[data-duration]');
      let ready = false;

      const updateProgress = () => {
        if (!ready) return;
        const hasDuration = Number.isFinite(audio.duration) && audio.duration > 0;
        const position = hasDuration
          ? Math.min(audio.duration, Math.max(0, audio.currentTime))
          : Math.max(0, audio.currentTime);
        const fraction = hasDuration ? position / audio.duration : 0;
        seek.value = hasDuration ? String(position) : '0';
        current.textContent = formatTime(position);
        seek.setAttribute('aria-valuetext', hasDuration
          ? `${formatTime(position)} of ${formatTime(audio.duration)}`
          : `${formatTime(position)} elapsed`);
        clip.setAttribute('width', String(fraction * 192));
        timeline.style.setProperty('--progress', `${fraction * 100}%`);
      };
      const updateDuration = () => {
        const hasDuration = Number.isFinite(audio.duration) && audio.duration > 0;
        seek.max = hasDuration ? String(audio.duration) : '1';
        seek.disabled = !ready || !hasDuration;
        duration.textContent = hasDuration ? formatTime(audio.duration) : '--:--';
        updateProgress();
      };
      const updatePlayback = () => {
        const playing = !audio.paused && !audio.ended;
        row.classList.toggle('is-playing', playing);
        button.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} ${label}`);
        button.title = playing ? 'Pause' : 'Play';
      };
      const showError = () => {
        ready = false;
        controls.hidden = true;
        placeholder.hidden = false;
        button.disabled = true;
        seek.disabled = true;
        row.classList.remove('is-ready', 'is-playing');
        status.textContent = 'Audio unavailable';
      };
      const togglePlayback = () => {
        if (!ready) return;
        if (!audio.paused) {
          audio.pause();
          return;
        }
        if (audio.ended) audio.currentTime = 0;
        audio.play().catch((error) => {
          // Switching samples can cancel a pending play request.
          if (error.name !== 'AbortError') showError();
        });
      };

      button.addEventListener('click', togglePlayback);
      row.addEventListener('click', (event) => {
        if (event.target.closest('button, input, a, label') || window.getSelection().toString()) return;
        togglePlayback();
      });
      seek.addEventListener('input', () => {
        if (!ready || seek.disabled) return;
        audio.currentTime = Number(seek.value);
        updateProgress();
      });
      for (const event of ['timeupdate', 'seeked', 'ended']) audio.addEventListener(event, updateProgress);
      for (const event of ['play', 'pause', 'ended']) audio.addEventListener(event, updatePlayback);
      audio.addEventListener('loadedmetadata', () => {
        // Streaming hosts may report Infinity until playback reaches the end.
        ready = true;
        button.disabled = false;
        controls.hidden = false;
        placeholder.hidden = true;
        row.classList.add('is-ready');
        updateDuration();
        updatePlayback();
      });
      audio.addEventListener('durationchange', updateDuration);
      audio.addEventListener('error', showError);
      pendingAudio.set(audio, () => {
        status.textContent = 'Loading audio…';
        const setSource = (value) => {
          audio.src = value;
          audio.load();
        };
        if (anonymousPage && sample.audioData) {
          // Complete WAV data avoids the host's unsupported byte-range requests.
          loadAudioBundle(sample.audioData).then(() => {
            const data = window.DUET_AUDIO_DATA && window.DUET_AUDIO_DATA[source];
            if (!data) throw new Error('Audio data is missing');
            setSource(data);
          }).catch(showError);
        } else {
          setSource(source);
        }
      });
    }
  }

  // One shared volume keeps comparisons at the same playback level.
  const volume = document.querySelector('.volume-slider');
  const mute = document.querySelector('.volume-button');
  let lastAudibleVolume = 1;
  const setVolume = (value) => {
    if (value > 0) lastAudibleVolume = value;
    players.forEach((audio) => { audio.volume = value; });
    volume.value = String(value);
    volume.setAttribute('aria-valuetext', `${Math.round(value * 100)} percent`);
    mute.classList.toggle('is-muted', value === 0);
    mute.setAttribute('aria-label', value === 0 ? 'Unmute audio' : 'Mute audio');
    mute.title = value === 0 ? 'Unmute audio' : 'Mute audio';
  };
  volume.addEventListener('input', () => setVolume(Number(volume.value)));
  mute.addEventListener('click', () => setVolume(Number(volume.value) > 0 ? 0 : lastAudibleVolume));
  setVolume(1);

  for (const tablist of document.querySelectorAll('[data-model-tabs], [data-sample-tabs]')) {
    const tabs = [...tablist.querySelectorAll('[role="tab"]')];
    const activate = (selectedTab) => {
      for (const tab of tabs) {
        const selected = tab === selectedTab;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
      }
      for (const audio of players) {
        if (audio.closest('[data-sample]').closest('[hidden]')) {
          audio.pause();
        } else if (pendingAudio.has(audio)) {
          // Load each clip once, when its sample is first shown.
          pendingAudio.get(audio)();
          pendingAudio.delete(audio);
        }
      }
    };
    for (const [index, tab] of tabs.entries()) {
      tab.addEventListener('click', () => activate(tab));
      tab.addEventListener('keydown', (event) => {
        let next;
        if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
        else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = tabs.length - 1;
        else return;
        event.preventDefault();
        activate(tabs[next]);
        tabs[next].focus();
      });
    }
    activate(tabs.find((tab) => tab.getAttribute('aria-selected') === 'true') || tabs[0]);
  }

  document.addEventListener('play', (event) => {
    if (!(event.target instanceof HTMLAudioElement)) return;
    for (const audio of players) {
      if (audio !== event.target) audio.pause();
    }
  }, true);
})();
