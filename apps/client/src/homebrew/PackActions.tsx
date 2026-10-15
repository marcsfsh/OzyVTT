import { useRef, useState } from "react";
import { Alert, Button, Modal, Switch, useToast } from "@vtt/ui";
import { homebrewApi, type HomebrewPack, type HomebrewPackImportReport } from "./api";
import { typeLabel } from "./types";

/**
 * Export and Import for homebrew packs, the GM-to-GM interchange. Export downloads every published record as
 * one file. Import reads a file, asks the server for a dry run, and shows that plan before anything is written;
 * everything lands as a hidden draft either way, so an import never changes what players see.
 */
export function PackActions({ gmToken, onImported }: Readonly<{ gmToken: string; onImported: () => void }>) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<{
    pack: HomebrewPack;
    fileName: string;
    overwrite: boolean;
    report: HomebrewPackImportReport;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exportPack = async () => {
    setBusy(true);
    try {
      const pack = await homebrewApi.exportPack(gmToken);
      if (pack.records.length === 0) {
        toast("Nothing is published yet, so there is nothing to export.", { tone: "info" });
        return;
      }
      const url = URL.createObjectURL(new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `homebrew-pack-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast(`Exported ${pack.records.length} published ${pack.records.length === 1 ? "record" : "records"}.`, {
        tone: "success"
      });
    } catch (exportError) {
      toast(exportError instanceof Error ? exportError.message : "Couldn't export the pack.", { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  /** The dry run is the server's own report for exactly what Import would do, re-asked when the policy changes. */
  const dryRun = async (pack: HomebrewPack, fileName: string, overwrite: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const report = await homebrewApi.importPack(gmToken, pack, {
        dryRun: true,
        onIdCollision: overwrite ? "overwrite" : "remint"
      });
      setPlan({ pack, fileName, overwrite, report });
    } catch (planError) {
      setError(planError instanceof Error ? planError.message : "Couldn't read that pack.");
    } finally {
      setBusy(false);
    }
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as HomebrewPack;
      if (!parsed || typeof parsed !== "object" || parsed.schemaId !== "vtt.homebrew-pack")
        throw new Error("That file isn't a homebrew pack.");
      await dryRun(parsed, file.name, false);
    } catch (readError) {
      toast(readError instanceof Error ? readError.message : "Couldn't read that file.", { tone: "error" });
    }
  };

  const apply = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const report = await homebrewApi.importPack(gmToken, plan.pack, {
        onIdCollision: plan.overwrite ? "overwrite" : "remint"
      });
      setPlan(null);
      onImported();
      toast(
        `Imported ${report.imported.length} ${report.imported.length === 1 ? "record" : "records"} as hidden drafts${
          report.rejected.length > 0 ? `; ${report.rejected.length} couldn't be read` : ""
        }.`,
        { tone: report.rejected.length > 0 ? "info" : "success" }
      );
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : "The import failed.");
    } finally {
      setBusy(false);
    }
  };

  const report = plan?.report;
  return (
    <div className="hb-pack-actions">
      <Button variant="secondary" size="sm" className="tap-target" disabled={busy} onClick={() => void exportPack()}>
        Export
      </Button>
      <Button
        variant="secondary"
        size="sm"
        className="tap-target"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
      >
        Import
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => {
          void pick(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      <Modal
        open={plan !== null}
        onClose={() => setPlan(null)}
        size="md"
        title="Import homebrew"
        ariaLabel="Import homebrew"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPlan(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={busy || !report || report.imported.length === 0}
              onClick={() => void apply()}
            >
              Import {report ? report.imported.length : ""}
            </Button>
          </>
        }
      >
        {plan && report && (
          <div className="hb-pack-plan">
            <p>
              {plan.pack.name || plan.fileName}: {report.imported.length}{" "}
              {report.imported.length === 1 ? "record" : "records"} will arrive as drafts only you can see.
            </p>
            {report.imported.length > 0 && (
              <ul className="hb-pack-list scroll-y">
                {report.imported.map((row) => (
                  <li key={row.id}>
                    {row.name} <span className="hb-pack-type">{typeLabel(row.type)}</span>
                  </li>
                ))}
              </ul>
            )}
            {report.reminted.length > 0 && (
              <p>
                {report.reminted.length} {report.reminted.length === 1 ? "gets a new id" : "get new ids"}:{" "}
                {report.reminted.map((row) => `${row.originalId} (${REMINT_REASONS[row.reason]})`).join(", ")}.
              </p>
            )}
            {report.overwritten.length > 0 && (
              <Alert tone="warning" title="These drafts will be replaced">
                <p>{report.overwritten.map((row) => row.name).join(", ")}</p>
              </Alert>
            )}
            {report.rejected.length > 0 && (
              <Alert tone="warning" title={`${report.rejected.length} can't be imported`}>
                <ul className="hb-pack-list">
                  {report.rejected.map((row) => (
                    <li key={row.originalId}>
                      {row.originalId || "A record with no id"}: {row.issues[0]?.message ?? "it couldn't be read"}
                    </li>
                  ))}
                </ul>
              </Alert>
            )}
            <Switch
              checked={plan.overwrite}
              onChange={(overwrite) => void dryRun(plan.pack, plan.fileName, overwrite)}
              label="Replace my drafts that share an id"
            />
            {error && <p className="hb-blocked">{error}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}

/** The report's reasons, in the GM's words. */
const REMINT_REASONS: Readonly<Record<HomebrewPackImportReport["reminted"][number]["reason"], string>> = {
  "srd-collision": "an SRD id",
  "homebrew-collision": "already taken here",
  "foreign-shape": "not an id this table makes"
};
