/**
 * Compile-and-deploy helper for MockUSDC.sol, plus transfer helpers.
 *
 * Compilation is cached in-process. Source of truth is the checked-in
 * .sol file.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import solc from 'solc';
import { encodeFunctionData, type Abi, type Hash } from 'viem';
import { ANVIL_ACCOUNT, anvilChain, publicClient, walletClient } from './anvil.ts';

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
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
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
  if (!contract) throw new Error('MockUSDC contract not found in solc output');
  cached = {
    abi: contract.abi,
    bytecode: ('0x' + contract.evm.bytecode.object) as `0x${string}`,
  };
  return cached;
}

export interface DeployedToken {
  readonly address: `0x${string}`;
  readonly abi: Abi;
}

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
  return { address: receipt.contractAddress, abi };
}

/**
 * Send a transfer and return the hash once mined. Uses the anvil default
 * account as the sender (it received the entire initial supply at deploy).
 *
 * This path uses writeContract, which is safe because the transaction is
 * valid (does not revert on chain).
 */
export async function sendTransfer(
  token: DeployedToken,
  to: `0x${string}`,
  value: bigint,
): Promise<Hash> {
  const hash = await walletClient.writeContract({
    address: token.address,
    abi: token.abi,
    functionName: 'transfer',
    args: [to, value],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/**
 * Send a transfer that will revert on chain, and return the mined hash so
 * the caller can verify the reverted-receipt path.
 *
 * We cannot use walletClient.writeContract here: viem does a simulateContract
 * pre-flight (eth_call) which anvil rejects synchronously with the revert
 * reason, so no transaction is ever broadcast. Instead we sign the tx locally
 * with explicit gas fields and broadcast the raw bytes via
 * eth_sendRawTransaction. This bypasses every viem pre-flight check —
 * the tx lands in the mempool, gets mined, and produces a receipt with
 * status = "reverted".
 */
export async function sendRevertingTransfer(
  token: DeployedToken,
  to: `0x${string}`,
  value: bigint,
): Promise<Hash> {
  const data = encodeFunctionData({
    abi: token.abi,
    functionName: 'transfer',
    args: [to, value],
  });

  const nonce = await publicClient.getTransactionCount({
    address: ANVIL_ACCOUNT.address,
  });

  // Explicit gas + fees skip eth_estimateGas and eth_fillTransaction.
  // 100_000 is more than enough for a simple ERC-20 transfer (~50k);
  // if it were somehow too little, we would still get a reverted receipt
  // (out-of-gas), which is fine for the test's purpose.
  const signed = await ANVIL_ACCOUNT.signTransaction({
    to: token.address,
    data,
    nonce,
    gas: 100_000n,
    maxFeePerGas: 1_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
    chainId: anvilChain.id,
    type: 'eip1559',
  });

  const hash = await publicClient.sendRawTransaction({
    serializedTransaction: signed,
  });
  await publicClient.waitForTransactionReceipt({ hash }).catch(() => {});
  return hash;
}
