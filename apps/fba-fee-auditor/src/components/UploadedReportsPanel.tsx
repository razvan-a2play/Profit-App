"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  cn,
} from "@platform/ui";
import { Upload, FileCheck, Loader2, Trash2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface UploadedInfo {
  format: string;
  filename: string;
  rowCount: number;
  skuCount: number;
  asinCount: number;
  headers: string[];
  uploadedAt: string;
}

const FORMAT_LABEL: Record<string, string> = {
  return_insights: "Return Insights & Opportunities",
  customer_returns: "Customer Returns detail",
  voice_of_customer: "Voice of the Customer",
  business_report: "Business Report (sales)",
  unknown: "Unrecognized format",
};

const FORMAT_TONE: Record<string, string> = {
  return_insights: "border-success/40 text-success",
  customer_returns: "border-info/40 text-info",
  voice_of_customer: "border-info/40 text-info",
  business_report: "border-warning/50 text-warning",
  unknown: "border-destructive/50 text-destructive",
};

export function UploadedReportsPanel() {
  const [uploads, setUploads] = useState<UploadedInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/uploads/returns");
    const body = await res.json();
    setUploads(body.uploads ?? []);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upload = useCallback(
    async (file: File) => {
      setBusy(true);
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/uploads/returns", { method: "POST", body: form });
        const body = await res.json();
        if (body.error) throw new Error(body.error);
        if (body.format === "unknown") {
          toast.warning(
            `Uploaded ${body.rowCount} rows but format not recognized. Headers seen: ${body.headers.slice(0, 5).join(", ")}...`,
          );
        } else {
          toast.success(
            `Uploaded ${body.rowCount} rows as ${FORMAT_LABEL[body.format]} — ${body.skuCount} SKUs · ${body.asinCount} ASINs.`,
          );
        }
        await refresh();
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const remove = useCallback(
    async (format: string) => {
      await fetch(`/api/uploads/returns?format=${format}`, { method: "DELETE" });
      toast.success(`Removed ${FORMAT_LABEL[format] ?? format}`);
      await refresh();
    },
    [refresh],
  );

  const onFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      for (const f of Array.from(files)) {
        if (!f.name.toLowerCase().endsWith(".csv") && !f.name.toLowerCase().endsWith(".tsv") && !f.name.toLowerCase().endsWith(".txt")) {
          toast.error(`Skipping ${f.name} — expected .csv/.tsv/.txt`);
          continue;
        }
        await upload(f);
      }
    },
    [upload],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Upload className="h-4 w-4" /> Upload Amazon CSV report
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Drop a CSV downloaded from Seller Central. Auto-detects the format and uses it to override SP-API counts
          (which cap at ~35% of the dashboard number). Supported: Return Insights, Customer Returns, Voice of Customer,
          Business Report.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void onFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors",
            dragOver
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50 hover:bg-muted/40",
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.tsv,.txt"
            multiple
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
          />
          {busy ? (
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          ) : (
            <Upload className="h-8 w-8 text-muted-foreground" />
          )}
          <p className="mt-2 text-sm font-medium">
            {busy ? "Parsing…" : "Drop CSV here, or click to pick a file"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Multiple files OK. Same format uploaded again replaces the previous copy.
          </p>
        </div>

        {uploads.length > 0 && (
          <div className="space-y-2">
            {uploads.map((u) => (
              <div
                key={u.format + u.uploadedAt}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3"
              >
                {u.format === "unknown" ? (
                  <AlertCircle className="h-4 w-4 text-destructive" />
                ) : (
                  <FileCheck className="h-4 w-4 text-success" />
                )}
                <Badge variant="outline" className={cn("text-[10px]", FORMAT_TONE[u.format])}>
                  {FORMAT_LABEL[u.format] ?? u.format}
                </Badge>
                <div className="text-sm">
                  <div className="font-medium">{u.filename}</div>
                  <div className="text-xs text-muted-foreground">
                    {u.rowCount.toLocaleString()} rows · {u.skuCount} SKUs · {u.asinCount} ASINs · uploaded{" "}
                    {new Date(u.uploadedAt).toLocaleString()}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => remove(u.format)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Where to find the CSVs in Seller Central</summary>
          <div className="mt-2 space-y-1 pl-4">
            <p>
              <strong>Return Insights CSV</strong> — <em>Reports → Return Insights &amp; Opportunities → Download report</em>.
              Matches the dashboard "Return units" exactly.
            </p>
            <p>
              <strong>Customer Returns</strong> — <em>Reports → Fulfillment → Customer Returns → Request .csv download</em>.
            </p>
            <p>
              <strong>Voice of the Customer</strong> — <em>Performance → Voice of the Customer → Export</em>.
            </p>
            <p>
              <strong>Business Report (sales)</strong> — <em>Reports → Business Reports → Detail Page Sales and Traffic
              by Child Item → Download</em>.
            </p>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
