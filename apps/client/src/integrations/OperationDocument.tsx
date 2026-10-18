import { useState } from "react";
import { Button, IconChevronLeft, SegmentedControl } from "@vtt/ui";
import { CALLER_WORDS, type OperationRow } from "./api-rows";
import {
  authOptions,
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
 * One operation as one document: what it does, its request, its responses and an example in the chosen language,
 * with a metadata panel beside it (method, path, who can call it with which scopes, operation id and tag). On a
 * phone the panel follows the document.
 */
export function OperationDocument({
  row,
  components,
  origin,
  onBack
}: Readonly<{ row: OperationRow; components: Components; origin: string; onBack: () => void }>) {
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

  return (
    <article className="api-doc" aria-labelledby="api-doc-title">
      <div className="api-doc-main">
        <Button variant="ghost" size="sm" className="api-doc-back" onClick={onBack}>
          <IconChevronLeft /> All operations
        </Button>
        <h2 id="api-doc-title">{row.summary || row.key}</h2>
        <p className="api-doc-route">
          <code className={`api-method api-method-${method}`}>{method.toUpperCase()}</code>
          <code className="api-path">{path}</code>
        </p>
        {operation.description && operation.description !== row.summary && (
          <p className="api-doc-description">{operation.description}</p>
        )}

        <section className="api-doc-part" aria-labelledby="api-doc-request">
          <h3 id="api-doc-request">Request</h3>
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
                      <td>
                        {typeLabel(parameter.schema ?? parameter.content?.["application/json"]?.schema, components)}
                      </td>
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
        </section>

        <section className="api-doc-part" aria-labelledby="api-doc-responses">
          <h3 id="api-doc-responses">Responses</h3>
          {Object.entries(operation.responses).map(([code, response]) => {
            const isError = typeof response.$ref === "string" || code >= "400";
            const schemaRef = response.content?.["application/json"]?.schema;
            const dataSchema = responseDataSchema(schemaRef, components);
            return (
              <div key={code} className={`api-response ${isError ? "api-response-error" : "api-response-ok"}`}>
                <p>
                  <code className="api-response-code">{code}</code>{" "}
                  {response.description ?? (typeof response.$ref === "string" ? "A stable API error." : "")}
                  {schemaRef && typeof schemaRef.$ref === "string" ? (
                    <em className="api-response-schema"> · {refName(schemaRef.$ref)}</em>
                  ) : null}
                </p>
                {dataSchema && <FieldTable rows={fieldRows(dataSchema, components)} caption={`Fields of ${code}`} />}
              </div>
            );
          })}
        </section>

        <section className="api-doc-part" aria-labelledby="api-doc-example">
          <div className="api-code-header">
            <h3 id="api-doc-example">Example</h3>
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
      </div>

      <aside className="api-doc-meta" aria-label="About this operation">
        <dl>
          <div>
            <dt>Method</dt>
            <dd>
              <code className={`api-method api-method-${method}`}>{method.toUpperCase()}</code>
            </dd>
          </div>
          <div>
            <dt>Path</dt>
            <dd>
              <code className="api-path">{path}</code>
            </dd>
          </div>
          <div>
            <dt>Who can call</dt>
            <dd>
              <ul className="api-meta-list">
                {row.callers.map((caller) => (
                  <li key={caller}>{CALLER_WORDS[caller]}</li>
                ))}
              </ul>
              {/* The document's own words, where they say more than the list: an integration's scope rule. */}
              {row.callers.includes("integration") && (
                <span className="api-meta-detail">{authOptions(operation).join(" · ")}</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Scopes</dt>
            <dd>
              {row.scopes.length > 0
                ? row.scopes.map((scope) => <code key={scope}>{scope}</code>)
                : row.callers.includes("integration")
                  ? "Set by the command type"
                  : "None"}
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
        </dl>
      </aside>
    </article>
  );
}
