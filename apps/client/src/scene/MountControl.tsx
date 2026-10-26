import { Button } from "@vtt/ui";

/** How a rider rides: controlling the mount, or letting it act on its own (SRD Mounted Combat). */
export type MountControlKind = "controlled" | "independent";

/**
 * Riding a mount from a token's menu (SRD Mounted Combat): climb onto a creature within 5 feet that is at least one
 * size larger, controlling it or letting it act on its own, or get off the one it rides. Either costs half the rider's
 * Speed; the server decides whether it may.
 */
export function MountControl({
  name,
  riding,
  controls = true,
  mounts,
  busy,
  onMount
}: Readonly<{
  name: string;
  /** The name of the creature it rides, if any. */
  riding: string | null;
  /** Whether the rider controls the mount it rides. */
  controls?: boolean;
  /** Creatures close and large enough to climb onto. */
  mounts: ReadonlyArray<Readonly<{ id: string; name: string }>>;
  busy: boolean;
  /** Climb onto a creature, or get off with null. */
  onMount: (mountId: string | null, control?: MountControlKind) => void;
}>) {
  if (!riding && mounts.length === 0) return null;
  return (
    <div className="encounter-mount" role="group" aria-label={`${name}'s mount`}>
      {riding ? (
        <>
          <span className="encounter-mount-note">
            {controls
              ? `${name} controls ${riding}: it acts after ${name} and can only Dash, Disengage or Dodge.`
              : `${riding} acts on its own.`}
          </span>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => onMount(null)}>
            Dismount from {riding}
          </Button>
        </>
      ) : (
        mounts.map((mount) => (
          <span key={mount.id} className="encounter-mount-pair">
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => onMount(mount.id, "controlled")}>
              Ride {mount.name}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onMount(mount.id, "independent")}>
              Ride {mount.name}, acting on its own
            </Button>
          </span>
        ))
      )}
    </div>
  );
}
