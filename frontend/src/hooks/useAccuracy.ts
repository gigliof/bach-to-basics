import { useEffect, useState } from "react";
import bus from "../engine/EventBus";
import { accuracyTracker } from "../engine/AccuracyTracker";

export interface AccuracyState {
  correct: number;
  wrong:   number;
  missed:  number;
  score:   number;   // 0-100
}

const INITIAL: AccuracyState = { correct: 0, wrong: 0, missed: 0, score: 0 };

/**
 * Returns live accuracy data from AccuracyTracker.
 * Automatically enables the tracker while the component is mounted.
 */
export function useAccuracy(enabled: boolean): AccuracyState {
  const [state, setState] = useState<AccuracyState>(INITIAL);

  useEffect(() => {
    accuracyTracker.enable(enabled);
    if (!enabled) {
      setState(INITIAL);
      return;
    }

    const handler = (data: AccuracyState) => setState({ ...data });
    bus.on("accuracy:update", handler as never);
    return () => {
      bus.off("accuracy:update", handler as never);
      accuracyTracker.enable(false);
    };
  }, [enabled]);

  return state;
}
