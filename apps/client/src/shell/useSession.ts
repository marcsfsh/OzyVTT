import { useEffect, useState } from "react";
import type { GmView, PlayerView } from "@vtt/domain";
import { useToast } from "@vtt/ui";
import type { NoticeMessage } from "../components/feedback";
import { jsonRequest } from "../lib/api";
import { joinTable, storedPlayerToken } from "../lib/session";
import { navigate } from "../router";
import { socket } from "../socket";

export type Connection = "online" | "reconnecting" | "offline";

/** Who this tab is signed in as. The GM token lives in memory only, so a hard refresh signs in again. */
export type Session = Readonly<{ role: "gm" | "player"; token: string }>;

/**
 * The tab's table session: the GM password setup and sign-in, the player's join, the socket and its
 * connection state, and the projected game state the server pushes.
 *
 * `enter` runs the landing's entry animation around `commit`, the change that mounts the app.
 */
export function useSession(enter: (commit: () => void) => void) {
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<PlayerView | GmView | null>(null);
  const [connection, setConnection] = useState<Connection>("online");
  const [bootstrapped, setBootstrapped] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * Pre-auth feedback stays inline beside the form that caused it (the landing's Notice is the one
   * exception to toast-only feedback). Post-auth feedback uses toasts: the locked frame has no row for
   * an inline message.
   */
  const [notice, setNotice] = useState<NoticeMessage>(null);
  const { toast } = useToast();

  useEffect(() => {
    jsonRequest<{ bootstrapped: boolean }>("/api/bootstrap/status")
      .then((status) => setBootstrapped(status.bootstrapped))
      .catch((error: Error) => setNotice({ tone: "error", text: error.message }));
    const onConnect = () => setConnection("online");
    const onDisconnect = () => setConnection("reconnecting");
    const onGaveUp = () => setConnection("offline");
    socket.on("state:updated", setState);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.io.on("reconnect_attempt", onDisconnect);
    socket.io.on("reconnect", onConnect);
    socket.io.on("reconnect_failed", onGaveUp);
    return () => {
      socket.off("state:updated", setState);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.io.off("reconnect_attempt", onDisconnect);
      socket.io.off("reconnect", onConnect);
      socket.io.off("reconnect_failed", onGaveUp);
    };
  }, []);

  /** Joins with `token` and, once the server accepts it, enters the app as `role`. */
  const join = async (role: Session["role"], token: string | undefined, refused: string) => {
    const result = await joinTable(token);
    setBusy(false);
    const accepted = role === "gm" ? token : (result.token ?? token);
    if (!result.ok || !accepted) {
      setNotice({ tone: "error", text: result.message ?? refused });
      return;
    }
    enter(() => {
      setSession({ role, token: accepted });
      setConnection("online");
      setNotice(null);
    });
  };

  const joinPlayer = () => {
    setBusy(true);
    setNotice({ tone: "info", text: "Connecting to the table…" });
    void join("player", storedPlayerToken(), "Couldn't join the table. Please try again.");
  };

  const signInGm = async (password: string) => {
    setBusy(true);
    try {
      const { token } = await jsonRequest<{ token: string }>("/api/gm/login", { body: { password } });
      await join("gm", token, "Couldn't sign in as GM.");
    } catch (error) {
      setBusy(false);
      setNotice({ tone: "error", text: (error as Error).message });
    }
  };

  const setGmPassword = async (password: string) => {
    setBusy(true);
    try {
      await jsonRequest("/api/bootstrap", { body: { password } });
      setBootstrapped(true);
      toast("GM password set. Enter it to begin.", { tone: "success" });
    } catch (error) {
      setNotice({ tone: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const leave = () => {
    socket.disconnect();
    setSession(null);
    setState(null);
    navigate("/");
  };

  /** Ends this GM session (sign out) or every GM session (revoke all), then returns to the landing. */
  const endGmSession = async (path: "/api/gm/logout" | "/api/gm/sessions/revoke-all", done: string) => {
    if (session?.role !== "gm") return;
    setBusy(true);
    try {
      await jsonRequest(path, { token: session.token, method: "POST" });
    } catch (error) {
      setBusy(false);
      toast((error as Error).message, { tone: "error" });
      return;
    }
    setBusy(false);
    leave();
    toast(done, { tone: "success" });
  };

  return {
    session,
    state,
    connection,
    bootstrapped,
    busy,
    notice,
    clearNotice: () => setNotice(null),
    joinPlayer,
    signInGm,
    setGmPassword,
    signOutGm: () => endGmSession("/api/gm/logout", "Signed out."),
    revokeAllGmSessions: () =>
      endGmSession("/api/gm/sessions/revoke-all", "All GM sessions revoked. Sign in again to continue."),
    leavePlayer: () => {
      leave();
      setNotice(null);
    }
  };
}
