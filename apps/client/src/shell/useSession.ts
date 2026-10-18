import { useCallback, useEffect, useRef, useState } from "react";
import type { ClaimReleasedEvent, GmView, PlayerView, SessionJoinResult } from "@vtt/domain";
import { useToast } from "@vtt/ui";
import type { NoticeMessage } from "../components/feedback";
import { HOST_PATHS } from "@vtt/api-contract";
import { apiRequest, onSessionEnded } from "../lib/api";
import { noteClaimReleased } from "../lib/claim-notice";
import {
  adoptGmToken,
  askOtherTabsForGmToken,
  forgetGmToken,
  replaceGmToken,
  shareGmToken,
  storedGmToken,
  storeGmToken
} from "../lib/gm-token";
import { forgetPlayerToken, joinTable, storedPlayerToken } from "../lib/session";
import { navigate } from "../router";
import { socket } from "../socket";
import { withNumberedNames } from "../table/numbering";

export type Connection = "online" | "reconnecting" | "offline";

/** Who this tab is signed in as. */
export type Session = Readonly<{ role: "gm" | "player"; token: string }>;

export const GM_SESSION_ENDED = "Your GM session ended. Sign in again.";
export const PLAYER_SESSION_ENDED = "Your seat at the table ended. Join again to choose your character.";

/** Whether a join was refused because the token sent is dead (ADR-0027). */
const deadToken = (result: SessionJoinResult) => !result.ok && result.code === "unauthenticated";

/**
 * The tab's table session: the GM password setup and sign-in, the player's join, the socket and its
 * connection state, and the projected game state the server pushes.
 *
 * A GM tab resumes after a reload, and a new tab picks up a GM session another tab holds (`lib/gm-token.ts`). When
 * the server says a session ended (revoked, run out, or the password changed elsewhere), the tab returns to the
 * landing with that reason.
 *
 * `enter` runs the landing's entry animation around `commit`, the change that mounts the app.
 */
export function useSession(enter: (commit: () => void) => void) {
  const [signedIn, setSignedIn] = useState<Session | null>(null);
  const [state, setState] = useState<PlayerView | GmView | null>(null);
  const [connection, setConnection] = useState<Connection>("online");
  const [bootstrapped, setBootstrapped] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  /** True while a stored or shared GM session is tried, so the landing doesn't offer a second way in. */
  const [resuming, setResuming] = useState(true);
  /** Opens the landing on the GM sign-in, as after a GM session ended. */
  const [gmPrompt, setGmPrompt] = useState(false);
  /**
   * Pre-auth feedback stays inline beside the form that caused it (the landing's Notice is the one
   * exception to toast-only feedback). Post-auth feedback uses toasts: the locked frame has no row for
   * an inline message.
   */
  const [notice, setNotice] = useState<NoticeMessage>(null);
  const { toast } = useToast();
  // Read by the socket and HTTP listeners, which outlive any one render.
  const current = useRef<Session | null>(null);
  current.current = signedIn;

  /** Back to the landing after the server ended this session, with the reason on the matching door. */
  const sessionEnded = useCallback(() => {
    const ended = current.current;
    if (!ended) return;
    current.current = null;
    socket.disconnect();
    setSignedIn(null);
    setState(null);
    if (ended.role === "gm") {
      forgetGmToken(ended.token);
      setGmPrompt(true);
      setNotice({ tone: "error", text: GM_SESSION_ENDED });
    } else {
      forgetPlayerToken();
      setGmPrompt(false);
      setNotice({ tone: "error", text: PLAYER_SESSION_ENDED });
    }
  }, []);

  useEffect(() => {
    apiRequest<{ bootstrapped: boolean }>(HOST_PATHS.setup)
      .then((status) => setBootstrapped(status.bootstrapped))
      .catch((error: Error) => setNotice({ tone: "error", text: error.message }));
    const onConnect = () => setConnection("online");
    const onDisconnect = () => setConnection("reconnecting");
    const onGaveUp = () => setConnection("offline");
    // Creatures of one kind are numbered by name in every list, as on their tokens.
    const onState = (next: PlayerView | GmView) => setState(withNumberedNames(next));
    socket.on("state:updated", onState);
    socket.on("session:ended", sessionEnded);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.io.on("reconnect_attempt", onDisconnect);
    socket.io.on("reconnect", onConnect);
    socket.io.on("reconnect_failed", onGaveUp);
    // An HTTP 401 for this tab's own token is the same news; one for a token already replaced is not.
    const stopListening = onSessionEnded((token) => {
      if (current.current?.token === token) sessionEnded();
    });
    const stopSharing = shareGmToken(() => (current.current?.role === "gm" ? current.current.token : null));
    return () => {
      socket.off("state:updated", onState);
      socket.off("session:ended", sessionEnded);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.io.off("reconnect_attempt", onDisconnect);
      socket.io.off("reconnect", onConnect);
      socket.io.off("reconnect_failed", onGaveUp);
      stopListening();
      stopSharing();
    };
  }, [sessionEnded]);

  // The GM let go of this player's character: back to the picker on the Table, with the toast now and the picker's
  // note until they claim again.
  useEffect(() => {
    const onReleased = (event: ClaimReleasedEvent) => {
      noteClaimReleased(event);
      void navigate("/table");
      toast(`The GM released ${event.name}. Choose a character to keep playing.`, { tone: "info" });
    };
    socket.on("claim:released", onReleased);
    return () => {
      socket.off("claim:released", onReleased);
    };
  }, [toast]);

  /**
   * Joins with `token` and, once the server accepts it, enters the app as `role`. A resumed GM session skips the
   * entry animation: the tab was in the app already.
   */
  const join = async (
    role: Session["role"],
    token: string | undefined,
    refused: string,
    options: Readonly<{ animate?: boolean }> = {}
  ): Promise<SessionJoinResult> => {
    const result = await joinTable(token);
    setBusy(false);
    const accepted = role === "gm" ? token : (result.token ?? token);
    if (!result.ok || !accepted) {
      if (!deadToken(result)) setNotice({ tone: "error", text: result.message ?? refused });
      return result;
    }
    const commit = () => {
      current.current = { role, token: accepted };
      setSignedIn({ role, token: accepted });
      setConnection("online");
      setNotice(null);
      setGmPrompt(false);
    };
    if (options.animate === false) commit();
    else enter(commit);
    return result;
  };

  // A GM tab picks up where it was: its own token after a reload, the one this computer keeps, or one another tab
  // shares. A token the server refuses is forgotten, and the sign-in says why.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const token = storedGmToken() ?? (await askOtherTabsForGmToken());
      if (cancelled) return;
      if (!token) {
        setResuming(false);
        return;
      }
      setBusy(true);
      const result = await join("gm", token, "Couldn't sign in as GM.", { animate: false });
      if (cancelled) return;
      setResuming(false);
      if (result.ok) {
        adoptGmToken(token);
        return;
      }
      forgetGmToken(token);
      socket.disconnect();
      if (deadToken(result)) {
        setGmPrompt(true);
        setNotice({ tone: "error", text: GM_SESSION_ENDED });
      }
    })();
    return () => {
      cancelled = true;
    };
    // Once, on load: `join` is rebuilt every render, and a second resume would join twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const joinPlayer = () => {
    setBusy(true);
    setNotice({ tone: "info", text: "Connecting to the table…" });
    void (async () => {
      const stored = storedPlayerToken();
      const result = await join("player", stored, "Couldn't join the table. Try again.");
      // A seat the server no longer knows: drop it and take a fresh one.
      if (stored && deadToken(result)) {
        forgetPlayerToken();
        setBusy(true);
        await join("player", undefined, "Couldn't join the table. Try again.");
      }
    })();
  };

  const signInGm = async (password: string, keep: boolean) => {
    setBusy(true);
    setNotice(null);
    try {
      const { token } = await apiRequest<{ token: string }>(HOST_PATHS.gmSignIn, { body: { password } });
      storeGmToken(token, keep);
      const result = await join("gm", token, "Couldn't sign in as GM.");
      if (!result.ok) forgetGmToken(token);
    } catch (error) {
      setBusy(false);
      setNotice({ tone: "error", text: (error as Error).message });
    }
  };

  const setGmPassword = async (password: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await apiRequest(HOST_PATHS.setup, { body: { password } });
      setBootstrapped(true);
      toast("GM password set. Enter it to begin.", { tone: "success" });
    } catch (error) {
      setNotice({ tone: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const leave = () => {
    current.current = null;
    socket.disconnect();
    setSignedIn(null);
    setState(null);
    navigate("/");
  };

  /** Ends this GM session (sign out) or every GM session (revoke all), then returns to the landing. */
  const endGmSession = async (path: typeof HOST_PATHS.gmSignOut | typeof HOST_PATHS.gmRevokeAll, done: string) => {
    const session = current.current;
    if (session?.role !== "gm") return;
    setBusy(true);
    try {
      await apiRequest(path, { token: session.token, method: "POST" });
    } catch (error) {
      setBusy(false);
      toast((error as Error).message, { tone: "error" });
      return;
    }
    setBusy(false);
    forgetGmToken(session.token);
    leave();
    toast(done, { tone: "success" });
  };

  /**
   * Changes the GM password. Every older GM session ends with it, so this tab moves its socket to the new token at
   * once; the other GM devices hear that their session ended a few seconds later. Resolves with the refusal's
   * message, or null when the password changed.
   */
  const changeGmPassword = async (currentPassword: string, newPassword: string): Promise<string | null> => {
    const session = current.current;
    if (session?.role !== "gm") return "Sign in as the GM first.";
    try {
      const { token } = await apiRequest<{ token: string }>(HOST_PATHS.gmPassword, {
        token: session.token,
        body: { currentPassword, newPassword }
      });
      replaceGmToken(token);
      current.current = { role: "gm", token };
      setSignedIn({ role: "gm", token });
      await joinTable(token);
      return null;
    } catch (error) {
      return (error as Error).message;
    }
  };

  return {
    signedIn,
    state,
    connection,
    bootstrapped,
    busy,
    resuming,
    gmPrompt,
    notice,
    clearNotice: () => setNotice(null),
    joinPlayer,
    signInGm,
    setGmPassword,
    changeGmPassword,
    signOutGm: () => endGmSession(HOST_PATHS.gmSignOut, "Signed out."),
    revokeAllGmSessions: () =>
      endGmSession(HOST_PATHS.gmRevokeAll, "All GM sessions revoked. Sign in again to continue."),
    leavePlayer: () => {
      leave();
      setNotice(null);
    }
  };
}
