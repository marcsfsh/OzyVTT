import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@vtt/domain";

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({ autoConnect: false });
