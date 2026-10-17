import { useState } from "react";
import { VIEWER_PATHS } from "@vtt/api-contract";
import { Button, Input, useToast } from "@vtt/ui";
import { apiRequest } from "../lib/api";

/** The six digits of a screen's code, however they were typed. */
export const codeDigits = (typed: string) => typed.replace(/\D/g, "");

/**
 * Pairing a table screen from the GM's side (ADR-0026): the screen shows a code, the GM types it here. A TV remote
 * never has to type anything.
 */
export function PairScreenForm({ gmToken, onPaired }: Readonly<{ gmToken: string; onPaired: () => void }>) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("Table screen");
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const ready = codeDigits(code).length === 6 && name.trim().length > 0;
  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      await apiRequest(VIEWER_PATHS.screenPairingsApprove, {
        token: gmToken,
        body: { code: codeDigits(code), name: name.trim() }
      });
      toast(`${name.trim()} is paired. It shows the table in a moment.`, { tone: "success" });
      setCode("");
      onPaired();
    } catch (failure) {
      toast((failure as Error).message, { tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="viewer-pair-form"
      aria-labelledby="viewer-pair-title"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h3 id="viewer-pair-title">Pair a table screen</h3>
      <p>Open the address above on the TV. It shows a six-digit code: type that code here.</p>
      <label>
        Code on the screen
        <Input
          value={code}
          inputMode="numeric"
          autoComplete="off"
          maxLength={9}
          onChange={(event) => setCode(event.target.value)}
        />
      </label>
      <label>
        Screen name
        <Input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
      </label>
      <Button variant="primary" type="submit" disabled={busy || !ready}>
        {busy ? "Pairing…" : "Pair screen"}
      </Button>
    </form>
  );
}
