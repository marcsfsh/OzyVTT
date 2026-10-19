import { Button } from "@vtt/ui";

/**
 * Riding a mount from a token's menu (SRD Mounted Combat): climb onto a creature within 5 feet that is at least one
 * size larger, or get off the one it rides. Either costs half the rider's Speed; the server decides whether it may.
 */
export function MountControl({
  name,
  riding,
  mounts,
  busy,
  onMount
}: Readonly<{
  name: string;
  /** The name of the creature it rides, if any. */
  riding: string | null;
  /** Creatures close and large enough to climb onto. */
  mounts: ReadonlyArray<Readonly<{ id: string; name: string }>>;
  busy: boolean;
  /** Climb onto a creature, or get off with null. */
  onMount: (mountId: string | null) => void;
}>) {
  if (!riding && mounts.length === 0) return null;
  return (
    <div className="encounter-mount" role="group" aria-label={`${name}'s mount`}>
      {riding ? (
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => onMount(null)}>
          Dismount from {riding}
        </Button>
      ) : (
        mounts.map((mount) => (
          <Button key={mount.id} size="sm" variant="secondary" disabled={busy} onClick={() => onMount(mount.id)}>
            Ride {mount.name}
          </Button>
        ))
      )}
    </div>
  );
}
