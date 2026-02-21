import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Badge } from "./ui/badge";
import { toast } from "sonner";
import type { Category } from "../lib/types";
import { useCreateEntry } from "../lib/hooks";
import { ApiError } from "../lib/api";
import { X, Loader2 } from "lucide-react";

interface NewEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category?: Category;
}

export function NewEntryDialog({
  open,
  onOpenChange,
  category,
}: NewEntryDialogProps) {
  const [selectedCategory, setSelectedCategory] = useState<Category>(
    category || "knowledge",
  );
  const [kind, setKind] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  const createEntry = useCreateEntry();

  const kindOptions = {
    knowledge: ["insight", "decision", "pattern"],
    entity: ["project", "contact", "tool"],
    event: ["session", "log"],
  };

  const handleAddTag = () => {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      setTags([...tags, tagInput.trim()]);
      setTagInput("");
    }
  };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const handleSave = () => {
    if (!kind || !title || !body) {
      toast.error("Please fill in all required fields");
      return;
    }

    createEntry.mutate(
      { kind, title, body, tags: tags.length > 0 ? tags : undefined },
      {
        onSuccess: () => {
          toast.success("Entry created");
          // Reset form
          setKind("");
          setTitle("");
          setBody("");
          setTags([]);
          setTagInput("");
          onOpenChange(false);
        },
        onError: (err) => {
          if (err instanceof ApiError) {
            if (err.status === 403) {
              toast.error("Entry limit reached", {
                description: "Upgrade your plan to add more entries.",
              });
            } else if (err.status === 400) {
              toast.error("Validation error", { description: err.message });
            } else {
              toast.error("Failed to create entry", {
                description: err.message,
              });
            }
          } else {
            toast.error("Failed to create entry");
          }
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Entry</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Category *</Label>
              <Select
                value={selectedCategory}
                onValueChange={(value) =>
                  setSelectedCategory(value as Category)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="knowledge">Knowledge</SelectItem>
                  <SelectItem value="entity">Entity</SelectItem>
                  <SelectItem value="event">Event</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Kind *</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger>
                  <SelectValue placeholder="Select kind" />
                </SelectTrigger>
                <SelectContent>
                  {kindOptions[selectedCategory].map((k) => (
                    <SelectItem key={k} value={k}>
                      {k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Title *</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter entry title..."
            />
          </div>

          <div className="space-y-2">
            <Label>Body *</Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="# Entry Title&#10;&#10;Your content in Markdown..."
              className="min-h-[200px] font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label>Tags</Label>
            <div className="flex gap-2">
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" && (e.preventDefault(), handleAddTag())
                }
                placeholder="Add tag..."
              />
              <Button type="button" onClick={handleAddTag} variant="outline">
                Add
              </Button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="gap-1">
                    {tag}
                    <button
                      onClick={() => handleRemoveTag(tag)}
                      className="ml-1 hover:text-destructive"
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={createEntry.isPending}>
            {createEntry.isPending && (
              <Loader2 className="size-4 mr-2 animate-spin" />
            )}
            Save Entry
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
