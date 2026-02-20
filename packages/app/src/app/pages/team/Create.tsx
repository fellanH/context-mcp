import { useState } from "react";
import { useNavigate } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Loader2 } from "lucide-react";
import { useCreateTeam } from "../../lib/hooks";
import { toast } from "sonner";

export function TeamCreate() {
  const navigate = useNavigate();
  const createTeam = useCreateTeam();
  const [name, setName] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    createTeam.mutate(name.trim(), {
      onSuccess: (data) => {
        toast.success(`Team "${data.name}" created`);
        navigate(`/team/${data.id}`);
      },
      onError: () => {
        toast.error("Failed to create team");
      },
    });
  };

  return (
    <div className="p-6 max-w-lg mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Create Team</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">New Team</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Team Name</Label>
              <Input
                id="name"
                placeholder="e.g. Engineering, Product, Research"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                You'll be the team owner and can invite members after creation.
              </p>
            </div>
            <Button
              type="submit"
              disabled={!name.trim() || createTeam.isPending}
              className="w-full"
            >
              {createTeam.isPending ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Team"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
