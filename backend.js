const express = require('express');
const WebSocket = require('ws');
const path = require('path');
const { spawn } = require('child_process');
const cors = require('cors');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Store active MCP connections
const mcpConnections = new Map();

// WebSocket server for real-time communication
const wss = new WebSocket.Server({ port: 8080 });

class MCPServerManager {
    constructor() {
        this.sessions = new Map();
    }

    async connectToServer(serverId, serverPath) {
        try {
            const isNodeJS = serverPath.endsWith('.js');
            const command = isNodeJS ? 'node' : 'py';
            
            // Spawn the MCP server process
            const serverProcess = spawn(command, [serverPath], {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            // Store the connection
            this.sessions.set(serverId, {
                process: serverProcess,
                tools: [],
                resources: [],
                initialized: false,
                pendingRequests: []
            });

            // Handle server responses
            serverProcess.stdout.on('data', (data) => {
                try {
                    const lines = data.toString().split('\n').filter(line => line.trim());
                    lines.forEach(line => {
                        if (line.trim()) {
                            const response = JSON.parse(line.trim());
                            this.handleServerResponse(serverId, response);
                        }
                    });
                } catch (error) {
                    console.error('Error parsing server response:', error);
                }
            });

            serverProcess.stderr.on('data', (data) => {
                console.error(`Server ${serverId} error:`, data.toString());
            });

            // Wait a moment for the server to start up
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Initialize MCP session
            const initMessage = {
                jsonrpc: "2.0",
                id: 1,
                method: "initialize",
                params: {
                    protocolVersion: "2024-11-05",
                    capabilities: {
                        tools: {},
                        resources: {}
                    },
                    clientInfo: {
                        name: "mcp-web-client",
                        version: "1.0.0"
                    }
                }
            };

            serverProcess.stdin.write(JSON.stringify(initMessage) + '\n');

            // Wait for initialization to complete
            await new Promise(resolve => setTimeout(resolve, 2000));

            return { success: true, serverId };
        } catch (error) {
            console.error('Failed to connect to server:', error);
            return { success: false, error: error.message };
        }
    }

    handleServerResponse(serverId, response) {
        const session = this.sessions.get(serverId);
        if (!session) return;

        // Check if this is the initialization response
        if (response.id === 1 && response.result) {
            console.log(`Server ${serverId} initialization response received, sending initialized notification`);
            
            // Send the "initialized" notification as required by MCP protocol
            const initializedNotification = {
                jsonrpc: "2.0",
                method: "notifications/initialized"
            };
            
            session.process.stdin.write(JSON.stringify(initializedNotification) + '\n');
            
            // Mark as initialized after sending the notification
            setTimeout(() => {
                session.initialized = true;
                console.log(`Server ${serverId} fully initialized`);
            }, 500);
        }

        // Broadcast to connected WebSocket clients
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'serverResponse',
                    serverId,
                    data: response
                }));
            }
        });
    }

    async listTools(serverId) {
        const session = this.sessions.get(serverId);
        if (!session) throw new Error('Server not connected');
        if (!session.initialized) {
            console.log('Waiting for server initialization...');
            // Wait longer for FastMCP initialization
            await new Promise(resolve => setTimeout(resolve, 2000));
            if (!session.initialized) {
                console.log('Still waiting for initialization...');
                await new Promise(resolve => setTimeout(resolve, 2000));
                if (!session.initialized) {
                    throw new Error('Server not initialized yet');
                }
            }
        }

        const message = {
            jsonrpc: "2.0",
            id: Date.now(),
            method: "tools/list"
        };

        session.process.stdin.write(JSON.stringify(message) + '\n');
    }

    async callTool(serverId, toolName, args) {
        const session = this.sessions.get(serverId);
        if (!session) throw new Error('Server not connected');
        if (!session.initialized) throw new Error('Server not initialized yet');

        const message = {
            jsonrpc: "2.0",
            id: Date.now(),
            method: "tools/call",
            params: {
                name: toolName,
                arguments: args
            }
        };

        session.process.stdin.write(JSON.stringify(message) + '\n');
    }

    async listResources(serverId) {
        const session = this.sessions.get(serverId);
        if (!session) throw new Error('Server not connected');
        if (!session.initialized) throw new Error('Server not initialized yet');

        const message = {
            jsonrpc: "2.0",
            id: Date.now(),
            method: "resources/list"
        };

        session.process.stdin.write(JSON.stringify(message) + '\n');
    }
}

const mcpManager = new MCPServerManager();

// REST API endpoints
app.post('/api/connect', async (req, res) => {
    const { serverPath } = req.body;
    const serverId = `server_${Date.now()}`;
    
    const result = await mcpManager.connectToServer(serverId, serverPath);
    res.json(result);
});

app.post('/api/tools/list/:serverId', async (req, res) => {
    try {
        await mcpManager.listTools(req.params.serverId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/tools/call/:serverId', async (req, res) => {
    try {
        const { toolName, args } = req.body;
        await mcpManager.callTool(req.params.serverId, toolName, args);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/resources/list/:serverId', async (req, res) => {
    try {
        await mcpManager.listResources(req.params.serverId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// WebSocket connection handling
wss.on('connection', (ws) => {
    console.log('WebSocket client connected');
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            // Handle WebSocket messages if needed
        } catch (error) {
            console.error('WebSocket message error:', error);
        }
    });

    ws.on('close', () => {
        console.log('WebSocket client disconnected');
    });
});

app.listen(PORT, () => {
    console.log(`MCP Web Client server running on http://localhost:${PORT}`);
    console.log(`WebSocket server running on ws://localhost:8080`);
});