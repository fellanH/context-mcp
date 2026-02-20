import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { toast } from "sonner";
import { uploadLocalVault, clearLocalConnection } from "../lib/api";
import { ApiError } from "../lib/api";
import { Loader2, Upload, ArrowRight } from "lucide-react";

interface UpgradeToHostedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hostedToken: string;
  entryCount: number;
}

export function UpgradeToHostedDialog({
  open,
  onOpenChange,
  hostedToken,
  entryCount,
}: UpgradeToHostedDialogProps) {
  const [uploading, setUploading] = useState(false);

  const reloadToHosted = () => {
    window.location.href = window.location.origin;
  };

  const handleUpload = async () => {
    setUploading(true);
    try {
      const result = await uploadLocalVault(hostedToken);
      toast.success(`Uploaded ${result.imported} entries to hosted vault`);
      clearLocalConnection();
      reloadToHosted();
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error("Upload failed", { description: err.message });
      } else {
        toast.error("Upload failed", {
          description: "An unexpected error occurred.",
        });
      }
      setUploading(false);
    }
  };

  const handleSkip = () => {
    clearLocalConnection();
    reloadToHosted();
  };

  if (entryCount === 0) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Switch to Hosted</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-4">
            No local entries to upload. You're ready to use hosted mode.
          </p>
          <div className="flex justify-end">
            <Button onClick={handleSkip}>
              Continue to hosted
              <ArrowRight className="size-4 ml-2" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Switch to Hosted</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            You have{" "}
            <span className="font-medium text-foreground">{entryCount}</span>{" "}
            entries in your local vault. Would you like to upload them to your
            hosted vault?
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Button onClick={handleUpload} disabled={uploading}>
            {uploading ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <Upload className="size-4 mr-2" />
            )}
            {uploading
              ? "Uploading entries..."
              : `Upload ${entryCount} entries and go hosted`}
          </Button>
          <Button variant="outline" onClick={handleSkip} disabled={uploading}>
            Skip — use hosted without uploading
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
