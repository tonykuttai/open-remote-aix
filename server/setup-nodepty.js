#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('Setting up node-pty for AIX Remote Server...');

// Paths
const sourcePtyPath = path.join(os.homedir(), 'utility', 'node-pty');
const targetDir = path.join(process.cwd(), 'node_modules', 'node-pty');

try {
    // Check if source exists
    if (!fs.existsSync(sourcePtyPath)) {
        console.log('⚠️ Source node-pty not found at:', sourcePtyPath);
        console.log('   Will fall back to spawn-based terminal');
        process.exit(0); // Exit gracefully, not an error
    }

    // Create node_modules directory if it doesn't exist
    const nodeModulesDir = path.join(process.cwd(), 'node_modules');
    if (!fs.existsSync(nodeModulesDir)) {
        fs.mkdirSync(nodeModulesDir, { recursive: true });
    }

    // Check if target already exists
    if (fs.existsSync(targetDir)) {
        console.log('⚠️ node-pty already exists in node_modules, removing...');
        fs.rmSync(targetDir, { recursive: true, force: true });
    }

    // Copy the working node-pty
    console.log(`📦 Copying node-pty from ${sourcePtyPath} to ${targetDir}`);
    copyDirectory(sourcePtyPath, targetDir);

    console.log('✅ node-pty setup complete!');
    
    // Test the installation
    console.log('🧪 Testing node-pty...');
    const pty = require(targetDir);
    console.log('✅ node-pty import successful!');
    
} catch (error) {
    console.log('⚠️ Setup failed, will fall back to spawn:', error.message);
    process.exit(0); // Exit gracefully
}

function copyDirectory(src, dest) {
    // Create destination directory
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }

    // Read source directory
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyDirectory(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}