-- Context MCP UI Launcher
-- Starts the server if not running, then opens the dashboard

on run
	-- Dynamic node path
	set nodePath to do shell script "which node"

	-- Dynamic serve.js path (relative to this script's bundle)
	set scriptDir to do shell script "dirname " & quoted form of (POSIX path of (path to me))
	set serverScript to scriptDir & "/serve.js"
	set serverPort to "3141"
	set serverURL to "http://localhost:" & serverPort

	-- Check if server is already running on port
	set isRunning to false
	try
		do shell script "lsof -ti:" & serverPort
		set isRunning to true
	end try

	-- Start server via nohup so it survives after this app exits
	if not isRunning then
		do shell script "nohup " & quoted form of nodePath & " " & quoted form of serverScript & " > /tmp/context-mcp.log 2>&1 &"
		-- Wait for server to be ready
		repeat 10 times
			delay 0.5
			try
				do shell script "curl -s -o /dev/null -w '%{http_code}' " & serverURL & "/api/discover"
				exit repeat
			end try
		end repeat
	end if

	-- Open in default browser
	open location serverURL
end run
