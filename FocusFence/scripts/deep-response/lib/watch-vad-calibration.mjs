export function extractWatchVADConfiguration(source) {
  return {
    voiceActivityThreshold: extractNumber(source, "voiceActivityThreshold"),
    minimumSpeechMilliseconds: extractNumber(source, "minimumSpeechMilliseconds"),
    endSilenceMilliseconds: extractNumber(source, "endSilenceMilliseconds")
  };
}

export function voiceActivityLevelPCM16(pcm) {
  const sampleCount = Math.floor(pcm.byteLength / 2);
  if (sampleCount === 0) {
    return 0;
  }

  let total = 0;
  for (let offset = 0; offset + 1 < pcm.byteLength; offset += 2) {
    total += Math.abs(pcm.readInt16LE(offset));
  }
  return total / sampleCount / 32767;
}

export function buildVADCalibrationCases(config) {
  return [
    {
      name: "digital_silence",
      pcm: generateConstantPCM16({ amplitude: 0 })
    },
    {
      name: "low_room_noise",
      pcm: generateAlternatingPCM16({ amplitude: Math.floor(config.voiceActivityThreshold * 32767 * 0.45) })
    },
    {
      name: "quiet_speech",
      pcm: generateAlternatingPCM16({ amplitude: Math.ceil(config.voiceActivityThreshold * 32767 * 1.35) })
    },
    {
      name: "normal_speech",
      pcm: generateSinePCM16({ amplitude: Math.ceil(config.voiceActivityThreshold * 32767 * 4) })
    }
  ];
}

export function summarizeVADCalibration(cases, config) {
  return cases.map((item) => {
    const level = voiceActivityLevelPCM16(item.pcm);
    return {
      name: item.name,
      level,
      threshold: config.voiceActivityThreshold,
      margin: level - config.voiceActivityThreshold,
      isVoice: level >= config.voiceActivityThreshold
    };
  });
}

function extractNumber(source, name) {
  const match = source.match(new RegExp(`var\\s+${name}\\s*=\\s*([0-9][0-9_.]*)`));
  if (!match) {
    throw new Error(`Missing Watch VAD configuration: ${name}`);
  }
  return Number(match[1].replaceAll("_", ""));
}

function generateConstantPCM16({ amplitude, samples = 1_600 }) {
  const pcm = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    pcm.writeInt16LE(amplitude, index * 2);
  }
  return pcm;
}

function generateAlternatingPCM16({ amplitude, samples = 1_600 }) {
  const pcm = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    pcm.writeInt16LE(index % 2 === 0 ? amplitude : -amplitude, index * 2);
  }
  return pcm;
}

function generateSinePCM16({ amplitude, samples = 1_600 }) {
  const pcm = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    const value = Math.round(Math.sin((2 * Math.PI * index) / 80) * amplitude);
    pcm.writeInt16LE(value, index * 2);
  }
  return pcm;
}
