import { useStore } from '@nanostores/react';
import { useState } from 'react';

import { downloadCcpLog } from '../lib/ccp';
import { $can, $view } from '../lib/stores';
import { $voiceLevel } from '../lib/voice';
import {
  $followTeamMeeting,
  $autoTranscribe,
  $helpQueueThreshold,
  $hideCallerIds,
  $proximityChat,
  $voiceModeDefault,
  $voiceThreshold,
  $phoneEditMode,
  $phoneLayout,
  $theme,
  DEFAULT_PHONE_LAYOUT,
  DEFAULT_VOICE_THRESHOLD,
  MAX_VOICE_THRESHOLD,
  MIN_VOICE_THRESHOLD,
  resetPhoneLayout,
  setFollowTeamMeeting,
  setAutoTranscribe,
  setHelpQueueThreshold,
  setHideCallerIds,
  setPhoneEditMode,
  setProximityChat,
  setVoiceModeDefault,
  setVoiceThreshold,
  setTheme,
  THEMES,
  type ThemeChoice,
  type VoiceMode,
} from '../lib/theme';
import { Button, Card, Icon } from './ui';

/** Position (0-100%) of a dBFS level on the voice threshold slider's scale. */
function levelPercent(db: number): number {
  const p = ((db - MIN_VOICE_THRESHOLD) / (MAX_VOICE_THRESHOLD - MIN_VOICE_THRESHOLD)) * 100;
  return Math.min(100, Math.max(0, p));
}

/** Slider for the mic level that opens map voice, with a live level meter. */
function VoiceThresholdSetting({ disabled }: { disabled: boolean }) {
  const threshold = useStore($voiceThreshold);
  const level = useStore($voiceLevel);
  // Drags apply live; the account is saved once the slider is let go.
  const commit = () => void setVoiceThreshold($voiceThreshold.get());
  const open = level != null && level > threshold;
  return (
    <div className="flex items-start gap-3 px-4 pb-4">
      <div className="flex w-44 shrink-0 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <input
            type="range"
            aria-label="Voice threshold"
            min={MIN_VOICE_THRESHOLD}
            max={MAX_VOICE_THRESHOLD}
            step={1}
            className="range range-xs range-primary grow"
            value={threshold}
            disabled={disabled}
            onChange={(e) => $voiceThreshold.set(e.target.valueAsNumber)}
            onPointerUp={commit}
            onKeyUp={commit}
            onBlur={commit}
          />
          <span className="w-12 text-right text-xs tabular-nums">{threshold} dB</span>
        </div>
        <div
          className="relative h-1.5 overflow-hidden rounded-full bg-secondary-200 dark:bg-secondary-700"
          title={level == null ? 'Open the Map to see your mic level' : `Mic level ${Math.round(level)} dB`}
        >
          {level != null && (
            <div
              className={`h-full transition-[width] duration-100 ${open ? 'bg-success' : 'bg-secondary-400'}`}
              style={{ width: `${levelPercent(level)}%` }}
            />
          )}
          <div className="absolute inset-y-0 w-0.5 bg-primary-500" style={{ left: `${levelPercent(threshold)}%` }} />
        </div>
      </div>
      <span className="flex grow flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm font-semibold">
          Voice threshold
          {threshold !== DEFAULT_VOICE_THRESHOLD && (
            <Button size="sm" onClick={() => void setVoiceThreshold(DEFAULT_VOICE_THRESHOLD)}>
              Reset
            </Button>
          )}
        </span>
        <span className="text-xs text-secondary-500 dark:text-secondary-400">
          How loud you must be for your mic to open. Move left to pick up quieter speech, right if background noise
          opens it. The bar shows your mic level while map voice is running and turns green above the threshold.
          {disabled && ' Only used in Voice threshold mode.'}
        </span>
      </span>
    </div>
  );
}

function ThemeTile({ choice, selected }: { choice: ThemeChoice; selected: boolean }) {
  // Each tile carries its own data-theme so it previews that theme's colors.
  const previewTheme = choice === 'system' ? undefined : choice;
  return (
    <button
      type="button"
      data-theme={previewTheme}
      onClick={() => void setTheme(choice)}
      aria-pressed={selected}
      className={`overflow-hidden rounded-lg border text-left transition hover:-translate-y-0.5 hover:shadow-md ${
        selected
          ? 'border-primary-500 ring-2 ring-primary-500'
          : 'border-secondary-200 dark:border-secondary-700'
      }`}
    >
      <div className="flex items-center gap-2 bg-base-100 px-3 py-2.5 text-base-content">
        <span className="grow truncate text-sm font-semibold capitalize">{choice}</span>
        {choice === 'system' ? (
          <span className="text-xs opacity-60">Follows OS</span>
        ) : (
          <span className="flex gap-1">
            {['bg-primary', 'bg-secondary', 'bg-accent', 'bg-neutral'].map((c) => (
              <span key={c} className={`h-4 w-2 rounded-sm ${c}`} />
            ))}
          </span>
        )}
        {selected && <Icon name="check" className="size-4 text-primary-500" />}
      </div>
    </button>
  );
}

export default function Settings() {
  const theme = useStore($theme);
  const followTeamMeeting = useStore($followTeamMeeting);
  const hideCallerIds = useStore($hideCallerIds);
  const helpQueueThreshold = useStore($helpQueueThreshold);
  const proximityChat = useStore($proximityChat);
  const voiceMode = useStore($voiceModeDefault);
  const autoTranscribe = useStore($autoTranscribe);
  const phoneLayout = useStore($phoneLayout);
  const phoneEditMode = useStore($phoneEditMode);
  const customLayout = JSON.stringify(phoneLayout) !== JSON.stringify(DEFAULT_PHONE_LAYOUT);
  const canMap = useStore($can('map'));
  const canTranscribe = useStore($can('transcription'));
  const [showThemes, setShowThemes] = useState(false)
  return (
    <>
    <Card title="Appearance">
      <div className="flex flex-col gap-3 p-4">
        <div className={"cursor-pointer hover:text-primary"} onClick={() => setShowThemes(!showThemes)}>
          <h3 className="text-sm font-semibold">{`${theme.slice(0, 1).toUpperCase()}${theme.slice(1)}`} Theme</h3>
        </div>
        {
          showThemes &&
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {(['system', ...THEMES] as ThemeChoice[]).map((t) => (
                <ThemeTile key={t} choice={t} selected={t === theme} />
            ))}
          </div>
        }
      </div>
    </Card>
    <Card title="Phone Section">
      <div className={"flex flex-row justify-between"}>
        <label className="flex cursor-pointer items-start gap-3 p-4">
          <input
              type="checkbox"
              className="toggle toggle-primary mt-0.5"
              checked={phoneEditMode}
              onChange={(e) => setPhoneEditMode(e.target.checked)}
          />
          <span className="flex flex-col gap-0.5">
          <div className={"flex flex-col"}>
            <span className="text-sm font-semibold">Phone Edit Mode</span>
            <span className="text-xs text-secondary-500 dark:text-secondary-400">
              Enable to rearrange cards on the Phone tab.
            </span>
          </div>
        </span>
        </label>
        <Button size="sm" className={"m-2"} disabled={!customLayout} onClick={() => void resetPhoneLayout()}>
          Reset
        </Button>
      </div>
      <div className="flex items-start justify-start gap-3 px-4 pb-4">
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">Reset Card arrangement</span>
        </span>
      </div>
        <label className="flex cursor-pointer items-start gap-3 p-4">
          <input
              type="checkbox"
              className="toggle toggle-primary mt-0.5"
              checked={followTeamMeeting}
              onChange={(e) => void setFollowTeamMeeting(e.target.checked)}
          />
          <span className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">Auto switch to in a meeting</span>
          <span className="text-xs text-secondary-500 dark:text-secondary-400">
            Switches when 50% of users are "In a Meeting"
          </span>
        </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 px-4 pb-4">
          <input
              type="number"
              min={0}
              step={1}
              className="input input-sm w-20"
              value={helpQueueThreshold}
              onChange={(e) => {
                if (e.target.value !== '') void setHelpQueueThreshold(e.target.valueAsNumber);
              }}
          />
          <span className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">High queue count alert</span>
          <span className="text-xs text-secondary-500 dark:text-secondary-400">
            When you're not taking calls and the queue rises, this will send an alert. 0 to disable
          </span>
        </span>
        </label>
      {canTranscribe && (
          <Card title="Transcription">
            <label className="flex cursor-pointer items-start gap-3 p-4">
              <input
                  type="checkbox"
                  className="toggle toggle-primary mt-0.5"
                  checked={autoTranscribe}
                  onChange={(e) => void setAutoTranscribe(e.target.checked)}
              />
              <span className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold">Auto start transcription</span>
            <span className="text-xs text-secondary-500 dark:text-secondary-400">
              Start transcribing the caller as soon as a call connects.
            </span>
          </span>
            </label>
          </Card>
      )}
    </Card>
    <Card title="Caller ID">
      <label className="flex cursor-pointer items-start gap-3 p-4">
        <input
          type="checkbox"
          className="toggle toggle-primary mt-0.5"
          checked={hideCallerIds}
          onChange={(e) => void setHideCallerIds(e.target.checked)}
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">Disable caller id</span>
          <span className="text-xs text-secondary-500 dark:text-secondary-400">
            Only show phone numbers.
          </span>
        </span>
      </label>
    </Card>
    {canMap && (
      <Card title="Map">
        <label className="flex cursor-pointer items-start gap-3 p-4">
          <input
            type="checkbox"
            className="toggle toggle-primary mt-0.5"
            checked={proximityChat}
            onChange={(e) => void setProximityChat(e.target.checked)}
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold">Proximity chat</span>
            <span className="text-xs text-secondary-500 dark:text-secondary-400">
              When off, map voice starts with your mic and speakers muted every time; unmute both to talk and listen.
              When on, your mute choices are remembered.
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 px-4 pb-4">
          <select
            className="select select-sm w-44"
            value={voiceMode}
            onChange={(e) => void setVoiceModeDefault(e.target.value as VoiceMode)}
          >
            <option value="threshold">Voice threshold</option>
            <option value="ptt">Push to talk</option>
          </select>
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold">Voice activation</span>
            <span className="text-xs text-secondary-500 dark:text-secondary-400">
              Voice threshold sends your mic whenever you speak. Push to talk sends only while you hold Space (anywhere
              except text fields) or the Hold to talk button. The map toolbar can switch modes until voice restarts.
            </span>
          </span>
        </label>
        <VoiceThresholdSetting disabled={voiceMode !== 'threshold'} />
      </Card>
    )}
    <Card title="Troubleshooting">
      <div className="flex flex-col items-start gap-2 p-4">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon="clock" onClick={() => $view.set('log')}>
            System log
          </Button>
        </div>
      </div>
    </Card>
    </>
  );
}
