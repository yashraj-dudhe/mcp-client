class MCPWebClient {
    constructor() {
        this.ws = null;
        this.currentServerId = null;
        this.tools = [];
        this.resources = [];
        this.initWebSocket();
    }

    initWebSocket() {
        this.ws = new WebSocket('ws://localhost:8080');
        
        this.ws.onopen = () => {
            this.log('WebSocket connected', 'success');
        };

        this.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.handleServerMessage(message);
            } catch (error) {
                this.log('Error parsing WebSocket message: ' + error.message, 'error');
            }
        };

        this.ws.onclose = () => {
            this.log('WebSocket disconnected', 'error');
            // Attempt to reconnect after 3 seconds
            setTimeout(() => this.initWebSocket(), 3000);
        };

        this.ws.onerror = (error) => {
            this.log('WebSocket error: ' + error.message, 'error');
        };
    }

    handleServerMessage(message) {
        this.log('Received: ' + JSON.stringify(message, null, 2));

        if (message.type === 'serverResponse') {
            const response = message.data;
            
            if (response.result) {
                if (response.result.tools) {
                    this.tools = response.result.tools;
                    this.renderTools();
                } else if (response.result.resources) {
                    this.resources = response.result.resources;
                    this.renderResources();
                } else if (response.result.content) {
                    this.renderToolResult(response.result);
                }
            }
        }
    }

    async connectToServer() {
        const serverPath = document.getElementById('serverPath').value;
        if (!serverPath) {
            this.showStatus('Please enter a server path', 'error');
            return;
        }

        try {
            const response = await fetch('/api/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ serverPath })
            });

            const result = await response.json();
            
            if (result.success) {
                this.currentServerId = result.serverId;
                this.showStatus('Connected to server successfully!', 'success');
                this.enableButtons();
                this.log('Connected to server: ' + serverPath, 'success');
                
                // Automatically list tools after connection
                setTimeout(() => this.listTools(), 1000);
            } else {
                this.showStatus('Failed to connect: ' + result.error, 'error');
            }
        } catch (error) {
            this.showStatus('Connection error: ' + error.message, 'error');
        }
    }

    async listTools() {
        if (!this.currentServerId) {
            this.showStatus('No server connected', 'error');
            return;
        }

        try {
            await fetch(`/api/tools/list/${this.currentServerId}`, {
                method: 'POST'
            });
            this.log('Requested tools list');
        } catch (error) {
            this.log('Error listing tools: ' + error.message, 'error');
        }
    }

    async callTool(toolName, args = {}) {
        if (!this.currentServerId) {
            this.showStatus('No server connected', 'error');
            return;
        }

        try {
            this.log(`Calling tool: ${toolName} with args: ${JSON.stringify(args)}`);
            
            await fetch(`/api/tools/call/${this.currentServerId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ toolName, args })
            });
        } catch (error) {
            this.log('Error calling tool: ' + error.message, 'error');
        }
    }

    async listResources() {
        if (!this.currentServerId) {
            this.showStatus('No server connected', 'error');
            return;
        }

        try {
            await fetch(`/api/resources/list/${this.currentServerId}`, {
                method: 'POST'
            });
            this.log('Requested resources list');
        } catch (error) {
            this.log('Error listing resources: ' + error.message, 'error');
        }
    }

    renderTools() {
        const container = document.getElementById('toolsContainer');
        container.innerHTML = '';

        if (this.tools.length === 0) {
            container.innerHTML = '<p>No tools available</p>';
            return;
        }

        this.tools.forEach(tool => {
            const toolCard = document.createElement('div');
            toolCard.className = 'tool-card';
            toolCard.onclick = () => this.showToolDialog(tool);

            toolCard.innerHTML = `
                <div class="tool-name">${tool.name}</div>
                <div class="tool-description">${tool.description || 'No description'}</div>
                <div class="tool-args">
                    ${tool.inputSchema ? 
                        'Args: ' + Object.keys(tool.inputSchema.properties || {}).join(', ') : 
                        'No arguments'
                    }
                </div>
            `;

            container.appendChild(toolCard);
        });

        this.log(`Rendered ${this.tools.length} tools`);
    }

    renderResources() {
        const container = document.getElementById('resourcesContainer');
        container.innerHTML = '';

        if (this.resources.length === 0) {
            container.innerHTML = '<p>No resources available</p>';
            return;
        }

        this.resources.forEach(resource => {
            const resourceDiv = document.createElement('div');
            resourceDiv.innerHTML = `
                <button onclick="client.viewResource('${resource.uri}')">
                    ${resource.name || resource.uri}
                </button>
            `;
            container.appendChild(resourceDiv);
        });

        this.log(`Rendered ${this.resources.length} resources`);
    }

    showToolDialog(tool) {
        const args = {};
        
        if (tool.inputSchema && tool.inputSchema.properties) {
            const properties = tool.inputSchema.properties;
            
            for (const [key, schema] of Object.entries(properties)) {
                const value = prompt(`Enter ${key} (${schema.type}):`, schema.default || '');
                if (value !== null) {
                    // Try to parse as JSON if it looks like JSON, otherwise use as string
                    try {
                        args[key] = schema.type === 'string' ? value : JSON.parse(value);
                    } catch {
                        args[key] = value;
                    }
                }
            }
        }

        this.callTool(tool.name, args);
    }

    renderToolResult(result) {
        const container = document.getElementById('resourceViewer');
        
        if (result.content && result.content[0]) {
            const content = result.content[0];
            
            if (content.type === 'text') {
                container.innerHTML = `
                    <h3>Tool Result:</h3>
                    <pre>${content.text}</pre>
                `;
            } else if (content.type === 'resource') {
                this.renderResource(content.resource);
            }
        }
    }

    renderResource(resource) {
        const container = document.getElementById('resourceViewer');
        
        if (resource.mimeType === 'text/html') {
            container.innerHTML = `
                <h3>Resource: ${resource.uri}</h3>
                <iframe srcdoc="${resource.text}" style="width: 100%; height: 400px; border: 1px solid #ddd;"></iframe>
            `;
        } else if (resource.mimeType === 'text/plain') {
            container.innerHTML = `
                <h3>Resource: ${resource.uri}</h3>
                <pre style="background: #f8f9fa; padding: 15px; border-radius: 4px;">${resource.text}</pre>
            `;
        } else {
            container.innerHTML = `
                <h3>Resource: ${resource.uri}</h3>
                <p>MIME Type: ${resource.mimeType}</p>
                <pre>${JSON.stringify(resource, null, 2)}</pre>
            `;
        }
    }

    enableButtons() {
        document.getElementById('listToolsBtn').disabled = false;
        document.getElementById('listResourcesBtn').disabled = false;
    }

    showStatus(message, type) {
        const statusDiv = document.getElementById('connectionStatus');
        statusDiv.innerHTML = `<div class="status ${type}">${message}</div>`;
        setTimeout(() => statusDiv.innerHTML = '', 5000);
    }

    log(message, type = '') {
        const logsDiv = document.getElementById('logs');
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = document.createElement('div');
        logEntry.innerHTML = `<span style="color: #666;">[${timestamp}]</span> ${message}`;
        if (type === 'error') logEntry.style.color = 'red';
        if (type === 'success') logEntry.style.color = 'green';
        
        logsDiv.appendChild(logEntry);
        logsDiv.scrollTop = logsDiv.scrollHeight;
    }

    clearLogs() {
        document.getElementById('logs').innerHTML = '';
    }
}

// Global functions for HTML onclick handlers
const client = new MCPWebClient();

function connectToServer() {
    client.connectToServer();
}

function listTools() {
    client.listTools();
}

function listResources() {
    client.listResources();
}

function clearLogs() {
    client.clearLogs();
}