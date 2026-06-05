export const deepResponseWatchConversationStates = [
  "listening",
  "userSpeaking",
  "assistantThinking",
  "assistantSpeaking",
  "bargeIn",
  "idleWaiting",
  "ending",
  "ended"
];

const defaultState = {
  isContinuousMode: false,
  isRecording: false,
  isWaitingForResponse: false,
  isHTTPSessionEnded: false,
  lastError: null,
  conversationState: "listening"
};

export function simulateDeepResponseWatchEvents(events = [], initialState = {}) {
  let state = { ...defaultState, ...initialState };
  const actions = [];
  for (const event of events) {
    const result = applyDeepResponseWatchEvent(state, event);
    state = result.state;
    actions.push(...result.actions);
  }
  return { state, actions };
}

export function applyDeepResponseWatchEvent(stateInput = {}, event = {}) {
  const state = { ...defaultState, ...stateInput };
  const actions = [];

  if (event.type === "view_disappeared") {
    actions.push("post_end:watch_teardown");
    actions.push("stop_runtime");
    if (state.isRecording) {
      actions.push("stop_recording");
    }
    return {
      state: {
        ...state,
        isContinuousMode: false,
        isRecording: false,
        isWaitingForResponse: false,
        isHTTPSessionEnded: false,
        conversationState: "ended"
      },
      actions
    };
  }

  if (event.type === "view_appeared") {
    actions.push("clear_client_diagnostics");
    return {
      state: {
        ...state,
        isContinuousMode: false,
        isRecording: false,
        isWaitingForResponse: false,
        isHTTPSessionEnded: false,
        lastError: null,
        conversationState: "listening"
      },
      actions
    };
  }

  if (event.type === "toggle_continuous") {
    if (!event.enabled && state.isRecording) {
      actions.push("stop_recording");
      return {
        state: {
          ...state,
          isContinuousMode: false,
          isRecording: false,
          isWaitingForResponse: false,
          conversationState: state.isHTTPSessionEnded ? "ended" : "listening"
        },
        actions
      };
    }
    if (!event.enabled && state.conversationState === "assistantSpeaking") {
      actions.push("local_stop_playback");
      return {
        state: {
          ...state,
          isContinuousMode: false,
          isRecording: false,
          isWaitingForResponse: false,
          conversationState: state.isHTTPSessionEnded ? "ended" : "listening"
        },
        actions
      };
    }
    if (!event.enabled && (state.conversationState === "assistantThinking" || state.isWaitingForResponse)) {
      return {
        state: {
          ...state,
          isContinuousMode: false,
          isRecording: false,
          isWaitingForResponse: false,
          conversationState: state.isHTTPSessionEnded ? "ended" : "listening"
        },
        actions
      };
    }
    return {
      state: {
        ...state,
        isContinuousMode: Boolean(event.enabled)
      },
      actions
    };
  }

  if (event.type === "recording_started") {
    if (state.isWaitingForResponse || state.isHTTPSessionEnded) {
      return {
        state: {
          ...state,
          conversationState: state.isHTTPSessionEnded ? "ended" : state.conversationState
        },
        actions
      };
    }
    return {
      state: {
        ...state,
        isRecording: true,
        conversationState: "userSpeaking"
      },
      actions
    };
  }

  if (event.type === "recording_finished") {
    const lastError = event.error ?? state.lastError;
    const isHTTPSessionEnded = Boolean(event.sessionEnded ?? state.isHTTPSessionEnded);
    if (lastError || isHTTPSessionEnded || !state.isContinuousMode) {
      return {
        state: {
          ...state,
          isRecording: false,
          isWaitingForResponse: false,
          isHTTPSessionEnded,
          lastError,
          conversationState: isHTTPSessionEnded ? "ended" : "listening"
        },
        actions
      };
    }

    if (event.playbackActive) {
      actions.push("wait_for_playback");
      return {
        state: {
          ...state,
          isRecording: false,
          isWaitingForResponse: false,
          isHTTPSessionEnded: false,
          lastError: null,
          conversationState: "assistantThinking"
        },
        actions
      };
    }

    actions.push("start_recording:auto_listening");
    return {
      state: {
        ...state,
        isRecording: true,
        isWaitingForResponse: false,
        isHTTPSessionEnded: false,
        lastError: null,
        conversationState: "userSpeaking"
      },
      actions
    };
  }

  if (event.type === "empty_recording") {
    if (state.isContinuousMode && !state.isHTTPSessionEnded && !state.lastError) {
      actions.push("start_recording:auto_listening");
      return {
        state: {
          ...state,
          isRecording: true,
          isWaitingForResponse: false,
          conversationState: "userSpeaking"
        },
        actions
      };
    }
    return {
      state: {
        ...state,
        isRecording: false,
        isWaitingForResponse: false,
        conversationState: state.isHTTPSessionEnded ? "ended" : "listening"
      },
      actions
    };
  }

  if (event.type === "playback_drained") {
    if (state.isHTTPSessionEnded) {
      return {
        state: {
          ...state,
          conversationState: "ended",
          isRecording: false
        },
        actions
      };
    }
    if (!state.isContinuousMode || state.isRecording || state.isWaitingForResponse || state.lastError) {
      return { state, actions };
    }
    actions.push("start_recording:auto_listening");
    return {
      state: {
        ...state,
        isRecording: true,
        conversationState: "userSpeaking"
      },
      actions
    };
  }

  if (event.type === "first_audio_received") {
    if (state.isHTTPSessionEnded) {
      return {
        state: {
          ...state,
          isRecording: false,
          conversationState: "ended"
        },
        actions
      };
    }
    if (state.conversationState !== "assistantThinking") {
      return { state, actions };
    }
    return {
      state: {
        ...state,
        isRecording: false,
        isWaitingForResponse: false,
        conversationState: "assistantSpeaking"
      },
      actions
    };
  }

  if (event.type === "abort_finished") {
    const lastError = event.error ?? state.lastError;
    const isHTTPSessionEnded = Boolean(state.isHTTPSessionEnded || event.sessionEnded);
    if (isHTTPSessionEnded) {
      return {
        state: {
          ...state,
          isRecording: false,
          isWaitingForResponse: false,
          isHTTPSessionEnded: true,
          lastError,
          conversationState: "ended"
        },
        actions
      };
    }
    actions.push("local_stop_playback");
    if (state.isContinuousMode && !lastError && !isHTTPSessionEnded) {
      actions.push("start_recording:barge_in");
      return {
        state: {
          ...state,
          isRecording: true,
          isWaitingForResponse: false,
          isHTTPSessionEnded: false,
          lastError: null,
          conversationState: "userSpeaking"
        },
        actions
      };
    }
    return {
      state: {
        ...state,
        isRecording: false,
        isWaitingForResponse: false,
        isHTTPSessionEnded,
        lastError,
        conversationState: isHTTPSessionEnded ? "ended" : "listening"
      },
      actions
    };
  }

  if (event.type === "abort_requested") {
    actions.push("local_stop_playback");
    actions.push("post_abort:background");
    if (state.isContinuousMode && !state.isHTTPSessionEnded && !state.lastError) {
      actions.push("start_recording:barge_in");
      return {
        state: {
          ...state,
          isRecording: true,
          isWaitingForResponse: false,
          conversationState: "userSpeaking"
        },
        actions
      };
    }
    return {
      state: {
        ...state,
        isRecording: false,
        isWaitingForResponse: false,
        conversationState: state.isHTTPSessionEnded ? "ended" : "listening"
      },
      actions
    };
  }

  if (event.type === "mic_pressed") {
    if (state.conversationState === "assistantSpeaking" && !state.isHTTPSessionEnded && !state.lastError) {
      const canAbort = event.canAbort !== false;
      actions.push("local_stop_playback");
      if (canAbort) {
        actions.push("post_abort:background");
      }
      if (state.isContinuousMode) {
        actions.push("start_recording:barge_in");
        return {
          state: {
            ...state,
            isRecording: true,
            isWaitingForResponse: false,
            conversationState: "userSpeaking"
          },
          actions
        };
      }
      return {
        state: {
          ...state,
          isRecording: false,
          isWaitingForResponse: false,
          conversationState: "listening"
        },
        actions
      };
    }
    if (!state.isRecording && !state.isWaitingForResponse && !state.isHTTPSessionEnded) {
      actions.push("start_recording:manual");
      return {
        state: {
          ...state,
          isRecording: true,
          conversationState: "userSpeaking"
        },
        actions
      };
    }
    return { state, actions };
  }

  if (event.type === "session_end") {
    if (state.isRecording) {
      actions.push("stop_recording");
    }
    actions.push("stop_auto_listen");
    actions.push("finalize_session_end");
    return {
      state: {
        ...state,
        isRecording: false,
        isWaitingForResponse: false,
        isHTTPSessionEnded: true,
        conversationState: "ending"
      },
      actions
    };
  }

  if (event.type === "session_end_finalized") {
    return {
      state: {
        ...state,
        isRecording: false,
        isWaitingForResponse: false,
        isHTTPSessionEnded: true,
        conversationState: "ended"
      },
      actions
    };
  }

  return { state, actions };
}
