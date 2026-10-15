/** A request refused for a reason the caller can fix. The message is written for them, so a router sends it as
 *  is; any other error a router catches is a fault and is answered with a fixed message instead. */
export class InvalidRequestError extends Error {}
