import { useState } from "react";
import { useSearchParams, useNavigate } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Loader2, CheckCircle, XCircle } from "lucide-react";
import { useJoinTeam } from "../../lib/hooks";

export function TeamInvite() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const joinTeam = useJoinTeam();

  const token = searchParams.get("token") || "";
  const teamId = searchParams.get("team") || "";
  const isMissingParams = !token || !teamId;
  const [status, setStatus] = useState<"idle" | "joining" | "success" | "error">(
    isMissingParams ? "error" : "idle"
  );
  const [errorMsg, setErrorMsg] = useState(
    isMissingParams ? "Invalid invite link. Missing token or team ID." : ""
  );

  const handleJoin = () => {
    if (!token || !teamId) return;
    setStatus("joining");

    joinTeam.mutate(
      { teamId, token },
      {
        onSuccess: (data) => {
          setStatus("success");
          setTimeout(() => navigate(`/team/${data.teamId}`), 1500);
        },
        onError: (err) => {
          setStatus("error");
          setErrorMsg(err.message || "Failed to join team");
        },
      }
    );
  };

  return (
    <div className="p-6 max-w-md mx-auto mt-12">
      <Card>
        <CardHeader>
          <CardTitle className="text-base text-center">Team Invite</CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          {status === "idle" && (
            <>
              <p className="text-sm text-muted-foreground">
                You've been invited to join a team. Click below to accept.
              </p>
              <Button onClick={handleJoin} className="w-full">
                Accept Invite
              </Button>
            </>
          )}

          {status === "joining" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Joining team...</p>
            </div>
          )}

          {status === "success" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle className="size-8 text-emerald-500" />
              <p className="text-sm font-medium">You've joined the team!</p>
              <p className="text-xs text-muted-foreground">Redirecting to team dashboard...</p>
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <XCircle className="size-8 text-red-500" />
              <p className="text-sm font-medium">Could not join team</p>
              <p className="text-xs text-muted-foreground">{errorMsg}</p>
              <Button variant="outline" onClick={() => navigate("/")} className="mt-2">
                Go to Dashboard
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
