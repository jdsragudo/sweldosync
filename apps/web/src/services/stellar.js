// apps/web/src/services/stellar.js
import {
  isConnected as freighterIsConnected,
  requestAccess as freighterRequestAccess,
  getAddress as freighterGetAddress,
  getNetworkDetails as freighterGetNetworkDetails,
  signTransaction as freighterSignTransaction,
} from '@stellar/freighter-api';
import {
  TransactionBuilder,
  Networks,
  Keypair,
  StrKey,
  Asset,
} from '@stellar/stellar-sdk';

export const TESTNET_PASSPHRASE = Networks.TESTNET;
export const MAINNET_PASSPHRASE = Networks.PUBLIC;

export function truncateStellarAddress(addr, lead = 4, tail = 4) {
  if (!addr || typeof addr !== 'string') return '';
  if (addr.length <= lead + tail) return addr;
  return `${addr.slice(0, lead)}…${addr.slice(-tail)}`;
}

export function formatExplorerTxUrl(txHash, network = 'testnet') {
  if (!txHash) return '#';
  const sub = network === 'mainnet' ? 'public' : 'testnet';
  return `https://stellar.expert/explorer/${sub}/tx/${txHash}`;
}

export function formatExplorerAccountUrl(address, network = 'testnet') {
  if (!address) return '#';
  const sub = network === 'mainnet' ? 'public' : 'testnet';
  return `https://stellar.expert/explorer/${sub}/account/${address}`;
}

export function generateTestWallet() {
  const kp = Keypair.random();
  // Return ONLY public key. Never store or expose secret keys in client code.
  return {
    publicKey: kp.publicKey(),
  };
}

export async function checkFreighterInstalled() {
  try {
    const res = await freighterIsConnected();
    if (typeof res === 'object' && res !== null) {
      return Boolean(res.isConnected);
    }
    return Boolean(res);
  } catch {
    return false;
  }
}

export async function connectFreighter() {
  try {
    const isAvail = await checkFreighterInstalled();
    if (!isAvail) {
      throw new Error('Freighter wallet extension not detected in this browser.');
    }
    const access = await freighterRequestAccess();
    if (access && access.error) {
      throw new Error(access.error);
    }
    const address = access?.address || (await freighterGetAddress())?.address;
    let net = 'TESTNET';
    let passphrase = TESTNET_PASSPHRASE;
    try {
      const netDetails = await freighterGetNetworkDetails();
      if (netDetails?.network) net = netDetails.network;
      if (netDetails?.networkPassphrase) passphrase = netDetails.networkPassphrase;
    } catch {
      // fallback
    }

    return {
      address,
      network: net,
      networkPassphrase: passphrase,
    };
  } catch (err) {
    throw new Error(err.message || 'Failed to connect Freighter wallet.');
  }
}

export async function signWithFreighter(unsignedXdr, networkPassphrase, accountToSign) {
  try {
    const sigResult = await freighterSignTransaction(unsignedXdr, {
      networkPassphrase,
      accountToSign,
    });
    if (sigResult && sigResult.error) {
      throw new Error(sigResult.error);
    }
    // Freighter v4+ returns { signedTxXdr } or raw string
    if (sigResult?.signedTxXdr) {
      return sigResult.signedTxXdr;
    }
    if (typeof sigResult === 'string') {
      return sigResult;
    }
    return sigResult;
  } catch (err) {
    throw new Error(err.message || 'Freighter signing rejected or failed.');
  }
}

/**
 * Trustless in-browser XDR Decoder using @stellar/stellar-sdk.
 * Parses the unsigned XDR transaction envelope and extracts verified facts:
 * - Source Account
 * - Network Passphrase
 * - Fee & Sequence Number
 * - Operation count and exact smart-routing classification
 * - Total outflow per asset
 * - SHA-256 MemoHash
 */
export function decodeTransactionXdr(unsignedXdr, networkPassphrase = TESTNET_PASSPHRASE) {
  if (!unsignedXdr) {
    throw new Error('No XDR provided to decode.');
  }

  try {
    const tx = TransactionBuilder.fromXDR(unsignedXdr, networkPassphrase);

    const sourceAccount = tx.source;
    const fee = tx.fee;
    const sequence = tx.sequence;
    const operations = [];
    const outflows = {}; // assetCode -> number

    for (let i = 0; i < tx.operations.length; i++) {
      const op = tx.operations[i];
      const opType = op.type;
      let details = { index: i, type: opType };

      if (opType === 'payment') {
        const assetCode = op.asset.isNative() ? 'XLM' : op.asset.getCode();
        const issuer = op.asset.isNative() ? null : op.asset.getIssuer();
        const amount = op.amount;
        details = {
          ...details,
          destination: op.destination,
          amount,
          assetCode,
          issuer,
          summary: `Direct Payment of ${amount} ${assetCode} to ${truncateStellarAddress(op.destination)}`,
        };
        outflows[assetCode] = (outflows[assetCode] || 0) + parseFloat(amount);
      } else if (opType === 'createAccount') {
        const amount = op.startingBalance;
        details = {
          ...details,
          destination: op.destination,
          amount,
          assetCode: 'XLM',
          summary: `Create & Fund Account with ${amount} XLM for ${truncateStellarAddress(op.destination)}`,
        };
        outflows['XLM'] = (outflows['XLM'] || 0) + parseFloat(amount);
      } else if (opType === 'createClaimableBalance') {
        const assetCode = op.asset.isNative() ? 'XLM' : op.asset.getCode();
        const issuer = op.asset.isNative() ? null : op.asset.getIssuer();
        const amount = op.amount;
        const claimants = (op.claimants || []).map((c) => ({
          destination: c.destination,
          predicate: c.predicate,
        }));
        details = {
          ...details,
          amount,
          assetCode,
          issuer,
          claimants,
          summary: `Create Claimable Balance of ${amount} ${assetCode} with ${claimants.length} claimants`,
        };
        outflows[assetCode] = (outflows[assetCode] || 0) + parseFloat(amount);
      } else {
        details.summary = `Operation: ${opType}`;
      }

      operations.push(details);
    }

    let memoType = 'none';
    let memoValue = null;
    let memoHashHex = null;

    if (tx.memo) {
      memoType = tx.memo.type;
      if (memoType === 'hash') {
        // tx.memo.value is a Buffer or Uint8Array
        const buf = tx.memo.value;
        memoHashHex = Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
        memoValue = memoHashHex;
      } else if (memoType === 'text') {
        memoValue = tx.memo.value;
      }
    }

    return {
      isValid: true,
      sourceAccount,
      networkPassphrase,
      fee,
      sequence,
      operationCount: tx.operations.length,
      operations,
      outflows,
      memoType,
      memoValue,
      memoHashHex,
    };
  } catch (err) {
    return {
      isValid: false,
      error: err.message,
    };
  }
}
