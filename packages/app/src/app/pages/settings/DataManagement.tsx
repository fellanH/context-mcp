import { useState, useRef } from "react";
import { useNavigate } from "react-router";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Textarea } from "../../components/ui/textarea";
import { Label } from "../../components/ui/label";
import { Badge } from "../../components/ui/badge";
import { Progress } from "../../components/ui/progress";
import { Input } from "../../components/ui/input";
import { Upload, Download, Trash2, Lock, Loader2 } from "lucide-react";
import { useAuth } from "../../lib/auth";
import {
  useImportEntry,
  useExportVault,
  useDeleteAccount,
  useRawUsage,
} from "../../lib/hooks";
import { toast } from "sonner";

export function DataManagement() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { data: rawUsage } = useRawUsage();
  const importMutation = useImportEntry();
  const { refetch: fetchExport } = useExportVault();
  const deleteMutation = useDeleteAccount();

  const [jsonInput, setJsonInput] = useState("");
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importTotal, setImportTotal] = useState(0);
  const [importCurrent, setImportCurrent] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImport = async () => {
    if (!jsonInput.trim()) return;
    let data: Record<string, unknown>[];
    try {
      data = JSON.parse(jsonInput);
      if (!Array.isArray(data)) {
        toast.error("Expected a JSON array of entries");
        return;
      }
    } catch {
      toast.error("Invalid JSON");
      return;
    }

    setImporting(true);
    setImportProgress(0);
    setImportTotal(data.length);
    setImportCurrent(0);

    let succeeded = 0;
    for (let i = 0; i < data.length; i++) {
      try {
        await importMutation.mutateAsync(data[i]);
        succeeded++;
      } catch {
        // continue with remaining entries
      }
      setImportCurrent(i + 1);
      setImportProgress(((i + 1) / data.length) * 100);
    }

    setImporting(false);
    setJsonInput("");
    toast.success(`Imported ${succeeded} of ${data.length} entries`);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setJsonInput(ev.target?.result as string);
    };
    reader.readAsText(file);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const result = await fetchExport();
      if (result.data) {
        const blob = new Blob([JSON.stringify(result.data.entries, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `context-vault-export-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success("Export downloaded");
      }
    } catch {
      toast.error("Failed to export vault data");
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteAccount = () => {
    deleteMutation.mutate(undefined, {
      onSuccess: () => {
        logout();
        navigate("/login");
      },
      onError: () => {
        toast.error("Failed to delete account");
      },
    });
  };

  const exportEnabled = rawUsage?.limits.exportEnabled ?? false;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Data</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Import, export, and manage your vault data.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Upload className="size-4" />
            <CardTitle className="text-base">Import</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="jsonInput">JSON entries</Label>
            <Textarea
              id="jsonInput"
              placeholder={`[\n  {\n    "category": "knowledge",\n    "kind": "insight",\n    "title": "...",\n    "body": "...",\n    "tags": ["tag1"]\n  }\n]`}
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              className="min-h-[160px] font-mono text-xs"
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleImport}
              disabled={importing || !jsonInput.trim()}
            >
              {importing ? (
                <>
                  <Loader2 className="size-3.5 animate-spin mr-1.5" />
                  {importCurrent}/{importTotal}
                </>
              ) : (
                "Import"
              )}
            </Button>
            <input
              type="file"
              ref={fileInputRef}
              accept=".json"
              className="hidden"
              onChange={handleFileUpload}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
            >
              Upload file
            </Button>
          </div>
          {importing && <Progress value={importProgress} className="h-1.5" />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Download className="size-4" />
            <CardTitle className="text-base">Export</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {!exportEnabled ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Lock className="size-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Export is available on Pro and Team plans.
                </span>
              </div>
              <Badge variant="secondary">Upgrade to Pro</Badge>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={handleExport}
              disabled={exporting}
            >
              {exporting ? (
                <Loader2 className="size-3.5 animate-spin mr-1.5" />
              ) : (
                <Download className="size-3.5 mr-1.5" />
              )}
              Download vault data
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Trash2 className="size-4 text-destructive" />
            <CardTitle className="text-base text-destructive">
              Danger Zone
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Permanently delete your account and all vault data. This action
            cannot be undone.
          </p>
          <div className="space-y-2">
            <Label htmlFor="deleteConfirm" className="text-xs">
              Type{" "}
              <span className="font-mono font-bold">delete my account</span> to
              confirm
            </Label>
            <Input
              id="deleteConfirm"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="delete my account"
              className="max-w-xs"
            />
          </div>
          <Button
            variant="destructive"
            size="sm"
            disabled={
              deleteConfirm !== "delete my account" || deleteMutation.isPending
            }
            onClick={handleDeleteAccount}
          >
            {deleteMutation.isPending ? (
              <>
                <Loader2 className="size-3.5 animate-spin mr-1.5" />
                Deleting...
              </>
            ) : (
              "Delete Account"
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
