import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.DOCS_PORT || 8081;

// Serve static files from docs directory
app.use('/docs', express.static(path.join(__dirname, 'docs')));

// Serve API spec
app.use('/api', express.static(path.join(__dirname, 'api')));

// Root redirect to Swagger UI
app.get('/', (req, res) => {
    res.redirect('/docs/swagger-ui.html');
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        service: 'payment-service-docs',
        timestamp: new Date().toISOString()
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`📚 Swagger UI: http://localhost:${PORT}/docs/swagger-ui.html`);
    console.log(`🗄️ ERD Viewer: http://localhost:${PORT}/docs/erd-viewer.html`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down documentation server...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n👋 Shutting down documentation server...');
    process.exit(0);
});
