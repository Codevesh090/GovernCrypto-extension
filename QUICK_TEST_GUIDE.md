# Quick Test Guide - Creator Plan Features

## Step 1: Check Capability Detection

1. **Open extension popup**
2. **Right-click → Inspect** (opens DevTools)
3. **Go to Console tab**
4. **Clear storage** (optional - to re-test detection):
   ```javascript
   chrome.storage.local.clear()
   ```
5. **Reload extension** (close and reopen popup)
6. **Enter your API keys** in setup screen
7. **Watch console** for these logs:

### ✅ Success Indicators:
```
[ElevenLabs] Detected tier: creator
[ElevenLabs] Final capabilities: {
  tier: "creator",
  hasVoiceLibrary: true,
  hasMultilingual: true,
  hasStreaming: true,
  hasVoiceCloning: true,
  ...
}
```

### ❌ Failure Indicators:
```
[ElevenLabs] Detected tier: free
[ElevenLabs] Final capabilities: {
  tier: "free",
  hasVoiceLibrary: false,
  hasMultilingual: false,
  ...
}
```

**If you see failure**: Copy the full console output and share it with me.

---

## Step 2: Test Voice Library

1. **Navigate to any proposal**
2. **Click voice settings button** (⚙️ icon)
3. **Check voice dropdown**:

### ✅ Success:
- You see 10+ voices grouped by category
- Dropdown is enabled (not grayed out)
- No "Upgrade to Starter" message

### ❌ Failure:
- You see only 1 voice (Sarah)
- Dropdown is disabled
- "Upgrade to Starter" message appears

**If you see failure**: 
- Check console for `[Voice Settings] Current capabilities:` log
- Share the capabilities object

---

## Step 3: Test Multilingual TTS

1. **Select a non-English language**:
   - Click language dropdown (next to "AI SUMMARY")
   - Choose Spanish (🇪🇸 ES) or French (🇫🇷 FR)

2. **Use voice AI**:
   - Click "🎙️ Ask AI" button
   - Say "What is this proposal about?"
   - Wait for AI response

3. **Check console** for:

### ✅ Success:
```
[TTS] Model selection - Language: es, Has multilingual: true, Has streaming: true
[TTS] Using multilingual model: eleven_turbo_v2_5
[TTS] Using model: eleven_turbo_v2_5, voice: ..., streaming: true, language: es
```

### ❌ Failure:
```
[TTS] Model selection - Language: es, Has multilingual: false, Has streaming: false
[TTS] Using basic model: eleven_monolingual_v1
```

**If you see failure**:
- The AI will speak in English even though you selected Spanish
- This means capability detection failed
- Share the console logs

---

## Step 4: Test Sound Effects

Click each button and listen for sounds:

### Connection Screen
- [ ] Connect Wallet - click sound
- [ ] Change Wallet - click sound
- [ ] Disconnect - click sound

### Proposals Screen
- [ ] Back button - click sound
- [ ] Reload button - click sound
- [ ] Tab switches - click sound
- [ ] Proposal cards - click sound

### Detail Screen
- [ ] Back button - click sound
- [ ] Vote buttons - vote-cast/error/warning sounds
- [ ] Voice settings button - click sound
- [ ] Language dropdown - open/close sounds
- [ ] Language selection - click sound

### Voice Settings Modal
- [ ] Open modal - open sound
- [ ] Close modal - close sound
- [ ] Toggle switches - click sound
- [ ] Save button - success sound

---

## Quick Fixes

### Fix 1: Force Creator Capabilities
If detection fails, run this in console:

```javascript
chrome.storage.local.set({
  elevenLabsCapabilities: {
    tier: 'creator',
    hasVoiceLibrary: true,
    hasMultilingual: true,
    hasStreaming: true,
    hasVoiceCloning: true,
    hasPronunciationDictionary: true,
    characterLimit: 100000,
    charactersUsed: 0,
    voiceLimit: 30
  }
});
```

Then reload extension and test again.

### Fix 2: Check API Key
Verify your ElevenLabs API key is correct:
1. Go to https://elevenlabs.io/app/settings/api-keys
2. Copy your API key
3. Re-enter it in the extension setup

### Fix 3: Check Subscription
Verify your subscription at https://elevenlabs.io/app/subscription
- Should show "Creator" plan
- Should show character limit (100K/month)

---

## What to Report

If something doesn't work, share:

1. **Console logs** (all `[ElevenLabs]` and `[TTS]` lines)
2. **Screenshots**:
   - Voice settings modal (showing voice dropdown)
   - Subscription page from ElevenLabs website
3. **Test results**:
   - Which language you selected
   - What language AI actually spoke
   - Which model console shows

---

## Expected Behavior (Creator Plan)

✅ **Voice Library**: 10+ voices available
✅ **Multilingual**: AI speaks in selected language
✅ **Streaming**: Fast audio playback
✅ **Model**: `eleven_turbo_v2_5` for non-English
✅ **Sound Effects**: All buttons make sounds

