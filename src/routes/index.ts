import { Router } from 'express';
import proposalRoutes from './proposals';
import vaultRoutes from './vaults';
import swapRoutes from './swap';
import historyRoutes from './history';
import poolRoutes from './pools';
import routerRoutes from './router';
import { SolPriceService } from '../../app/services/sol-price.service';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'OK' });
});

// SOL/USD price endpoint
router.get('/sol-price', async (_req, res) => {
  try {
    const solPriceService = SolPriceService.getInstance();
    const price = await solPriceService.getSolPrice();
    res.json({ price });
  } catch (error) {
    console.error('Error fetching SOL price:', error);
    res.status(500).json({ error: 'Failed to fetch SOL price' });
  }
});

router.use('/proposals', proposalRoutes);
router.use('/vaults', vaultRoutes);
router.use('/swap', swapRoutes);
router.use('/history', historyRoutes);
router.use('/pools', poolRoutes);
router.use('/router', routerRoutes);

export default router;