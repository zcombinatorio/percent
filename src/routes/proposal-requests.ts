/*
 * Copyright (C) 2025 Spice Finance Inc.
 *
 * This file is part of Z Combinator.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { Router } from 'express';
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { getPool } from '../../app/utils/database';
import { LoggerService } from '../../app/services/logger.service';

const router = Router();
const logger = new LoggerService('api').createChild('proposal-requests');

/**
 * POST /api/proposal-requests
 * Submit a new proposal request (for non-whitelisted users)
 */
router.post('/', async (req, res) => {
  try {
    const {
      submitterWallet,
      title,
      description,
      choices,
      proposalLengthHours,
      isReportStaker,
      signature,
      message
    } = req.body;

    // Validate required fields
    if (!submitterWallet || !title || !description || !choices || !proposalLengthHours) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['submitterWallet', 'title', 'description', 'choices', 'proposalLengthHours']
      });
    }

    // Validate signature and message for wallet ownership verification
    if (!signature || !message) {
      return res.status(400).json({
        error: 'Missing signature fields',
        required: ['signature', 'message']
      });
    }

    // Validate wallet address format (basic check)
    if (typeof submitterWallet !== 'string' || submitterWallet.length < 32 || submitterWallet.length > 44) {
      return res.status(400).json({ error: 'Invalid wallet address format' });
    }

    // Validate choices is an array
    if (!Array.isArray(choices) || choices.length === 0) {
      return res.status(400).json({ error: 'Choices must be a non-empty array' });
    }

    // Verify message timestamp (5-minute window to prevent replay attacks)
    let parsedMessage: { action: string; timestamp: number; nonce: string };
    try {
      parsedMessage = JSON.parse(message);
    } catch {
      logger.warn('[POST /] Invalid message format');
      return res.status(400).json({ error: 'Invalid message format: must be valid JSON' });
    }

    const FIVE_MINUTES = 5 * 60 * 1000;
    if (Math.abs(Date.now() - parsedMessage.timestamp) > FIVE_MINUTES) {
      logger.warn('[POST /] Message expired', {
        messageAge: Math.abs(Date.now() - parsedMessage.timestamp)
      });
      return res.status(400).json({ error: 'Message expired: timestamp outside 5-minute window' });
    }

    // Verify signature to prove wallet ownership
    try {
      const messageBytes = new TextEncoder().encode(message);
      const signatureBytes = bs58.decode(signature);
      const publicKey = new PublicKey(submitterWallet);

      const isValid = nacl.sign.detached.verify(
        messageBytes,
        signatureBytes,
        publicKey.toBytes()
      );

      if (!isValid) {
        logger.warn('[POST /] Invalid signature', { submitterWallet });
        return res.status(403).json({ error: 'Invalid signature: wallet ownership verification failed' });
      }
    } catch (error) {
      logger.warn('[POST /] Signature verification error', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(400).json({ error: 'Signature verification failed' });
    }

    logger.info('[POST /] Signature verified', { submitterWallet });

    const pool = getPool();

    const result = await pool.query(
      `INSERT INTO qm_proposal_request
       (submitter_wallet, title, description, choices, proposal_length_hours, is_report_staker)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, created_at`,
      [
        submitterWallet,
        title,
        description,
        JSON.stringify(choices),
        proposalLengthHours,
        isReportStaker || false
      ]
    );

    res.status(201).json({
      success: true,
      id: result.rows[0].id,
      createdAt: result.rows[0].created_at
    });
  } catch (error) {
    console.error('Error submitting proposal request:', error);
    res.status(500).json({ error: 'Failed to submit proposal request' });
  }
});

export default router;
