import { useState } from "react";
import {
  authChips,
  authOptions,
  codeSample,
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
  type Language,
  type Operation
} from "./openapi-model";

/** One endpoint of the reference, expanded on demand to its parameters, body, example and responses. */
function FieldTable({ rows }: Readonly<{ rows: readonly FieldRow[] }>) {
  if (rows.length === 0) return <p className="api-detail-empty">No fields.</p>;
  return (
    <table className="api-field-table">
      <thead>
        <tr>
          <th>Field</th>
          <th>Type</th>
          <th>Req</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.name}>
            <td>
              <code>{row.name}</code>
            </td>
            <td>{row.type}</td>
            <td>{row.required ? "yes" : "-"}</td>
            <td>{row.note}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function EndpointDetails({
  method,
  path,
  operation,
  components,
  origin,
  language
}: Readonly<{
  method: string;
  path: string;
  operation: Operation;
  components: Components;
  origin: string;
  language: Language;
}>) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const parameters = operation.parameters ?? [];
  const jsonBody = operation.requestBody?.content?.["application/json"]?.schema;
  const bodySchema = jsonBody
    ? typeof jsonBody.$ref === "string"
      ? resolveRef(jsonBody.$ref, components)
      : jsonBody
    : undefined;
  const rawBodyTypes = operation.requestBody && !jsonBody ? Object.keys(operation.requestBody.content ?? {}) : [];
  const needsAuth = !authOptions(operation).some((label) => label.startsWith("public"));

  const examplePath = path.replace(/\{[a-zA-Z]+\}/g, EXAMPLE_UUID);
  const exampleJson = bodySchema ? exampleBody(bodySchema, components) : null;
  const sample = codeSample(language, method, `${origin}${examplePath}`, needsAuth, exampleJson, rawBodyTypes);
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
    <details className="api-endpoint" onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}>
      <summary>
        <span className="api-reference-route">
          <code className={`api-method api-method-${method}`}>{method.toUpperCase()}</code>
          <code className="api-path">{path}</code>
          <span className="api-auth">
            {authChips(operation).map((chip) => (
              <em key={chip}>{chip}</em>
            ))}
          </span>
        </span>
        {operation.description && <span className="api-endpoint-summary">{operation.description}</span>}
      </summary>
      {open && (
        <div className="api-endpoint-body">
          <p className="api-detail-line">
            <strong>Authorized principals:</strong> {authOptions(operation).join(" · ")}
          </p>

          {parameters.length > 0 && (
            <div className="api-detail-block">
              <h4>Parameters</h4>
              <table className="api-field-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>In</th>
                    <th>Type</th>
                    <th>Req</th>
                  </tr>
                </thead>
                <tbody>
                  {parameters.map((parameter) => (
                    <tr key={`${parameter.in}-${parameter.name}`}>
                      <td>
                        <code>{parameter.name}</code>
                      </td>
                      <td>{parameter.in}</td>
                      <td>{typeLabel(parameter.schema, components)}</td>
                      <td>{parameter.required ? "yes" : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {bodySchema && (
            <div className="api-detail-block">
              <h4>Request body{operation.requestBody?.required ? "" : " (optional)"}</h4>
              <FieldTable rows={fieldRows(bodySchema, components)} />
            </div>
          )}
          {rawBodyTypes.length > 0 && (
            <div className="api-detail-block">
              <h4>Request body</h4>
              <p className="api-detail-line">
                Raw <code>{rawBodyTypes.join(", ")}</code> bytes.
              </p>
            </div>
          )}

          <div className="api-detail-block">
            <div className="api-code-header">
              <h4>Example request</h4>
              <span className="api-code-lang">{LANGUAGES.find((entry) => entry.id === language)?.label}</span>
              <button type="button" className="api-copy" onClick={copySample}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <pre className="api-code">
              <code>{sample}</code>
            </pre>
          </div>

          <div className="api-detail-block">
            <h4>Responses</h4>
            {Object.entries(operation.responses).map(([code, response]) => {
              const isError = typeof response.$ref === "string" || code >= "400";
              const schemaRef = response.content?.["application/json"]?.schema;
              const dataSchema = responseDataSchema(schemaRef, components);
              return (
                <div key={code} className={`api-response ${isError ? "api-response-error" : "api-response-ok"}`}>
                  <p>
                    <code className="api-response-code">{code}</code>{" "}
                    {response.description ?? (typeof response.$ref === "string" ? "Stable API error" : "")}
                    {schemaRef && typeof schemaRef.$ref === "string" ? (
                      <em className="api-response-schema"> - {refName(schemaRef.$ref)}</em>
                    ) : null}
                  </p>
                  {dataSchema && <FieldTable rows={fieldRows(dataSchema, components)} />}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </details>
  );
}
