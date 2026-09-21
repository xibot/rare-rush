import { defineConfig } from 'hardhat/config';
export default defineConfig({ networks: { default: { type: 'edr-simulated', chainType: 'l1', chainId: 31337 } } });
