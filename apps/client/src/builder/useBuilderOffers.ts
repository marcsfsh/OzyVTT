import { useEffect, useRef, useState } from "react";
import type { BuilderOffersReply, BuilderOffersRequest } from "@vtt/domain";
import { read } from "../lib/command";

export type BuilderOffers = Readonly<{
  /** The latest answer, kept on screen while the next one is in flight. */
  reply: BuilderOffersReply | null;
  /** Whether `reply` answers the current request, so its offers and ledger rows are this draft's. */
  current: boolean;
  /** The table's refusal of the current request, in its own words. */
  refusal: string | null;
}>;

/**
 * Asks the table what a draft's content asks it to pick (`builder:offers`), again after every change. The
 * last answer stays until the next arrives, and an answer to a request already superseded is dropped, so
 * a slow reply never replaces a newer one. `null` asks nothing.
 */
export function useBuilderOffers(request: BuilderOffersRequest | null): BuilderOffers {
  const key = request === null ? null : JSON.stringify(request);
  const [answer, setAnswer] = useState<{ key: string; reply: BuilderOffersReply | null; refusal: string | null }>();
  const latest = useRef<string | null>(null);
  useEffect(() => {
    latest.current = key;
    if (key === null) return;
    void read("builder:offers", JSON.parse(key) as BuilderOffersRequest).then((result) => {
      if (latest.current !== key) return;
      if (result.ok && result.offers && result.picks && result.asiIncreases && result.choices) {
        const { offers, picks, asiIncreases, choices } = result;
        setAnswer({
          key,
          reply: { offers, picks, asiIncreases, subclassId: result.subclassId ?? null, choices },
          refusal: null
        });
      } else {
        // A refusal keeps the last offers on screen beside the reason.
        setAnswer((previous) => ({
          key,
          reply: previous?.reply ?? null,
          refusal: result.message ?? "The table could not work out what this build asks for."
        }));
      }
    });
  }, [key]);
  const current = answer !== undefined && answer.key === key;
  return {
    reply: answer?.reply ?? null,
    current: current && answer.refusal === null,
    refusal: current ? answer.refusal : null
  };
}
