import { useState } from "react";
import { useMediaQuery } from "../lib/useMediaQuery";
import { Button, Crumb, SegmentedControl, TitleLine } from "@vtt/ui";
import { CALLER_WORDS, type OperationRow } from "./api-rows";
import {
  codeSample,
  documentedExample,
  EXAMPLE_UUID,
  exampleBody,
  fieldRows,
  LANGUAGES,
  refName,
  resolveRef,
  responseDataSchema,
  typeLabel,
  type Components,
  type FieldRow,
  type Language
} from "./openapi-model";

const LANGUAGE_KEY = "vtt.api-language";

function readLanguage(): Language {
  try {
    const stored = localStorage.getItem(LANGUAGE_KEY);
    if (LANGUAGES.some((entry) => entry.id === stored)) return stored as Language;
  } catch {
    /* private mode: the first language */
  }
  return "shell";
}

function FieldTable({ rows, caption }: Readonly<{ rows: readonly FieldRow[]; caption: string }>) {
  if (rows.length === 0) return <p className="api-detail-empty">No fields.</p>;
  return (
    <div className="api-table-scroll">
      <table className="api-field-table">
        <caption className="nh-sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Type</th>
            <th scope="col">Required</th>
            <th scope="col">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name}>
              <td>
                <code>{row.name}</code>
              </td>
              <td>{row.type}</td>
              <td>{row.required ? "Yes" : "No"}</td>
              <td>{row.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One operation (I leftovers spec 2.2): its summary with All operations as the crumb, the method and path with Copy,
 * what it does, and one line of who can call it, its id, its tag and its command; then REQUEST and RESPONSE side by
 * side, each with its fields and its example, and the other responses as rows under the response. A phone shows one
 * side at a time under a control.
 */
export function OperationDocument({
  row,
  components,
  origin,
  onBack,
  command = null
}: Readonly<{
  row: OperationRow;
  components: Components;
  origin: string;
  onBack: () => void;
  /** The live-game command this operation is, named in its line (I leftovers spec 2.3). */
  command?: string | null;
}>) {
  const phone = useMediaQuery("(max-width: 650px)");
  const [side, setSide] = useState<"request" | "response">("request");
  const [pathCopied, setPathCopied] = useState(false);
  const { method, path, operation } = row;
  const [language, setLanguage] = useState<Language>(readLanguage);
  const [copied, setCopied] = useState(false);
  const parameters = operation.parameters ?? [];
  const jsonBody = operation.requestBody?.content?.["application/json"]?.schema;
  const bodySchema = jsonBody
    ? typeof jsonBody.$ref === "string"
      ? resolveRef(jsonBody.$ref, components)
      : jsonBody
    : undefined;
  const rawBodyTypes = operation.requestBody && !jsonBody ? Object.keys(operation.requestBody.content ?? {}) : [];
  const needsAuth = !row.callers.includes("anyone");
  const examplePath = path.replace(/\{[a-zA-Z]+\}/g, EXAMPLE_UUID);
  // The server's own worked example where it has one; otherwise one built from the body's schema.
  const exampleJson = documentedExample(operation) ?? (bodySchema ? exampleBody(bodySchema, components) : null);
  const sample = codeSample(language, method, `${origin}${examplePath}`, needsAuth, exampleJson, rawBodyTypes);

  const choose = (next: Language) => {
    setLanguage(next);
    try {
      localStorage.setItem(LANGUAGE_KEY, next);
    } catch {
      /* the choice lasts this visit */
    }
  };
  const copySample = async () => {
    try {
      await navigator.clipboard.writeText(sample);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked; the code is selectable */
    }
  };

  const responses = Object.entries(operation.responses);
  const [mainCode, mainResponse] = responses.find(([code]) => code.startsWith("2")) ?? responses[0] ?? ["", undefined];
  const mainSchemaRef = mainResponse?.content?.["application/json"]?.schema;
  const mainData = responseDataSchema(mainSchemaRef, components);
  const responseExample = mainData ? exampleBody(mainData, components) : null;
  const others = responses.filter(([code]) => code !== mainCode);
  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(path);
      setPathCopied(true);
      setTimeout(() => setPathCopied(false), 1500);
    } catch {
      /* clipboard blocked; the path is selectable */
    }
  };

  const request = (
    <section className="api-doc-part api-side" aria-labelledby="api-doc-request">
      <h3 id="api-doc-request" className="api-side-head">
        Request
      </h3>
      {parameters.length === 0 && !bodySchema && rawBodyTypes.length === 0 && (
        <p className="api-detail-empty">It takes no parameters and no body.</p>
      )}
      {parameters.length > 0 && (
        <div className="api-table-scroll">
          <table className="api-field-table">
            <caption className="nh-sr-only">Parameters</caption>
            <thead>
              <tr>
                <th scope="col">Parameter</th>
                <th scope="col">In</th>
                <th scope="col">Type</th>
                <th scope="col">Required</th>
                <th scope="col">Notes</th>
              </tr>
            </thead>
            <tbody>
              {parameters.map((parameter) => (
                <tr key={`${parameter.in}-${parameter.name}`}>
                  <td>
                    <code>{parameter.name}</code>
                  </td>
                  <td>{parameter.in}</td>
                  {/* A JSON-encoded query value carries its schema under `content`. */}
                  <td>{typeLabel(parameter.schema ?? parameter.content?.["application/json"]?.schema, components)}</td>
                  <td>{parameter.required ? "Yes" : "No"}</td>
                  <td>{parameter.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {bodySchema && (
        <>
          <h4>Body{operation.requestBody?.required ? "" : ", optional"}</h4>
          {operation.requestBody?.description && <p>{operation.requestBody.description}</p>}
          <FieldTable rows={fieldRows(bodySchema, components)} caption="Body fields" />
        </>
      )}
      {rawBodyTypes.length > 0 && (
        <>
          <p>
            The body is the raw bytes of a <code>{rawBodyTypes.join(", ")}</code> file.
          </p>
          {operation.requestBody?.description && <p>{operation.requestBody.description}</p>}
        </>
      )}
      <div className="api-code-header">
        <h4 id="api-doc-example">Example request</h4>
        <SegmentedControl
          size="sm"
          ariaLabel="Example language"
          value={language}
          onChange={(value) => choose(value as Language)}
          options={LANGUAGES.map((entry) => ({ value: entry.id, label: entry.label }))}
        />
        <Button size="sm" variant="secondary" onClick={() => void copySample()}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="api-code">
        <code>{sample}</code>
      </pre>
    </section>
  );

  const response = (
    <section className="api-doc-part api-side" aria-labelledby="api-doc-responses">
      <h3 id="api-doc-responses" className="api-side-head">
        Response{mainCode && " · "}
        {mainCode && <code className="api-response-code">{mainCode}</code>}
      </h3>
      {mainResponse && (
        <p className="api-response-line">
          {mainResponse.description ?? (typeof mainResponse.$ref === "string" ? "A stable API error." : "")}
          {mainSchemaRef && typeof mainSchemaRef.$ref === "string" ? (
            <em className="api-response-schema"> · {refName(mainSchemaRef.$ref)}</em>
          ) : null}
        </p>
      )}
      {mainData && <FieldTable rows={fieldRows(mainData, components)} caption={`Fields of ${mainCode}`} />}
      {responseExample && (
        <>
          <h4>Example response</h4>
          <pre className="api-code">
            <code>{JSON.stringify({ ok: true, data: responseExample }, null, 2)}</code>
          </pre>
        </>
      )}
      {others.length > 0 && (
        <ul className="api-other-responses" aria-label="Other responses">
          {others.map(([code, other]) => (
            <li key={code} className={`api-response ${code >= "400" ? "api-response-error" : "api-response-ok"}`}>
              <code className="api-response-code">{code}</code>
              <span>{other.description ?? (typeof other.$ref === "string" ? "A stable API error." : "")}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <article className="api-doc" aria-labelledby="api-doc-title">
      <div className="api-doc-main">
        <TitleLine crumb={<Crumb label="All operations" onClick={onBack} />}>
          <h2 id="api-doc-title">{row.summary || row.key}</h2>
        </TitleLine>
        <p className="api-doc-route">
          <code className={`api-method api-method-${method}`}>{method.toUpperCase()}</code>
          <code className="api-path">{path}</code>
          <Button size="sm" onClick={() => void copyPath()}>
            {pathCopied ? "Copied" : "Copy"}
          </Button>
        </p>
        {operation.description && operation.description !== row.summary && (
          <p className="api-doc-description">{operation.description}</p>
        )}
        {/* Who can call it, its id, its tag and its command, as one line under the title. */}
        <aside className="api-doc-meta" aria-label="About this operation">
          <dl>
            <div>
              <dt>Who can call</dt>
              <dd>
                {row.callers.map((caller) => CALLER_WORDS[caller]).join(", ")}
                {row.scopes.length > 0 && <> ({row.scopes.join(", ")})</>}
                {row.callers.includes("integration") && row.scopes.length === 0 && " (scope set by the command type)"}
              </dd>
            </div>
            <div>
              <dt>Operation id</dt>
              <dd>
                <code>{operation.operationId ?? "None"}</code>
              </dd>
            </div>
            <div>
              <dt>Tag</dt>
              <dd>
                {row.tag}
                {row.tagNote && <span className="api-meta-detail">{row.tagNote}</span>}
              </dd>
            </div>
            <div>
              <dt>Command</dt>
              <dd>{command ? <code>{command}</code> : "No command"}</dd>
            </div>
            <div className="nh-sr-only">
              <dt>Path</dt>
              <dd>
                <code className="api-path">{path}</code>
              </dd>
            </div>
          </dl>
        </aside>
        {phone && (
          <SegmentedControl
            ariaLabel="Request or response"
            value={side}
            onChange={(value) => setSide(value as typeof side)}
            options={[
              { value: "request", label: "Request" },
              { value: "response", label: mainCode ? `Response · ${mainCode}` : "Response" }
            ]}
          />
        )}
        <div className="api-sides">
          {(!phone || side === "request") && request}
          {(!phone || side === "response") && response}
        </div>
      </div>
    </article>
  );
}
