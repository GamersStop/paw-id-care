const express = require('express');
const router = express.Router();
const { readJson, writeJson } = require('../utils/storage');

// GET ALL DISPATCH TICKETS (GET /api/rescuer/dispatches)
router.get('/dispatches', (req, res) => {
    const dispatchLogs = readJson('dispatch_logs.json');
    return res.json({
        success: true,
        dispatches: dispatchLogs
    });
});

// UPDATE DISPATCH TICKET STATUS & PROOF (PUT /api/rescuer/dispatch/:id)
router.put('/dispatch/:id', (req, res) => {
    const { id } = req.params;
    const { status, notes, proofPhoto } = req.body;

    // 1. Role-Based Access Control: Require RESCUER Role
    let authHeader = req.headers['authorization'] || req.headers['x-user-role'] || req.headers['role'];
    let headerRole = null;
    if (authHeader && typeof authHeader === 'string') {
        headerRole = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : authHeader.trim();
    }

    const role = req.body.userRole || req.body.role || headerRole;
    const username = req.body.username || req.headers['x-user-username'] || req.headers['x-username'];

    let isAuthorizedRescuer = (role && typeof role === 'string' && role.trim().toUpperCase() === 'RESCUER');

    if (!isAuthorizedRescuer && username) {
        const rescuers = readJson('rescuers.json');
        const matchedRescuer = rescuers.find(r => 
            r.credentials && r.credentials.username.toLowerCase() === username.trim().toLowerCase()
        );
        if (matchedRescuer && (!role || role.trim().toUpperCase() === 'RESCUER')) {
            isAuthorizedRescuer = true;
        }
    }

    if (!isAuthorizedRescuer) {
        return res.status(403).json({ 
            success: false, 
            error: "Access denied. You must be logged in as an authorized Rescuer to update dispatch logs." 
        });
    }

    let dispatchLogs = readJson('dispatch_logs.json');

    const index = dispatchLogs.findIndex(d => d.dispatchId === id);
    if (index === -1) {
        return res.status(404).json({ success: false, error: "Dispatch record not found." });
    }

    if (status) dispatchLogs[index].status = status;
    if (notes) dispatchLogs[index].notes = `${dispatchLogs[index].notes || ''} [Update]: ${notes}`;
    if (proofPhoto) dispatchLogs[index].proofPhoto = proofPhoto;
    if (status === "RESOLVED" || status === "COMPLETED") {
        dispatchLogs[index].resolvedAt = new Date().toISOString();
    }

    writeJson('dispatch_logs.json', dispatchLogs);

    return res.json({
        success: true,
        message: "Dispatch status updated successfully.",
        dispatch: dispatchLogs[index]
    });
});

module.exports = router;
