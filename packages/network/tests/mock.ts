/**
 * Compile-and-deploy helper for MockUSDC.sol.
 *
 * Compilation happens ONCE per test session via the `solc` npm package.
 * The result is cached in memory and reused. Source of truth is the checked-in
 * .sol file — no pre-compiled artifact to keep in sync.
 *
 * Deployment is via viem's walletClient.deployContract, which sends a real
 * transaction to anvil and waits for the receipt. The deployed address is
 * deterministic per deployment (anvil increments nonces).
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import solc from 'solc';
import type { Abi, Hash } from 'viem';
import { publicClient, walletClient } from './setup.ts';

const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(here, 'contracts/MockUSDC.sol');

interface Compiled {
  readonly abi: Abi;
  readonly bytecode: `0x${string}`;
}

let cached: Compiled | null = null;

function compile(): Compiled {
  if (cached) return cached;

  const source = readFileSync(sourcePath, 'utf8');
  const input = {
    language: 'Solidity',
    sources: { 'MockUSDC.sol': { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        '*': { '*': ['abi', 'evm.bytecode.object'] },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input))) as {
    errors?: { severity: string; formattedMessage: string }[];
    contracts?: Record<string, Record<string, { abi: Abi; evm: { bytecode: { object: string } } }>>;
  };

  const fatal = output.errors?.filter((e) => e.severity === 'error') ?? [];
  if (fatal.length > 0) {
    throw new Error(
      'Solidity compilation failed:\n' + fatal.map((e) => e.formattedMessage).join('\n'),
    );
  }

  const contract = output.contracts?.['MockUSDC.sol']?.['MockUSDC'];
  if (!contract) {
    throw new Error('MockUSDC contract not found in solc output');
  }

  cached = {
    abi: contract.abi,
    bytecode: ('0x' + contract.evm.bytecode.object) as `0x${string}`,
  };
  return cached;
}

export interface DeployedToken {
  readonly address: `0x${string}`;
  readonly abi: Abi;
  readonly hash: Hash;
}

/**
 * Deploy a fresh MockUSDC to anvil. Each call deploys a NEW contract,
 * consuming the next nonce of the deployer account. Tests should cache
 * the deployed address per file via beforeAll, not per test.
 */
export async function deployMockUSDC(initialSupply: bigint): Promise<DeployedToken> {
  const { abi, bytecode } = compile();
  const hash = await walletClient.deployContract({
    abi,
    bytecode,
    args: [initialSupply],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) {
    throw new Error('Deployment receipt has no contractAddress');
  }
  return {
    address: receipt.contractAddress,
    abi,
    hash,
  };
}
