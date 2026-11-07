/**
 * Local *in-process* composition of the existing experimental modules.
 * No listener, account-registration endpoint, real users, database or persistence.
 * Do not expose this composition outside loopback integration tests.
 */
import {createIdentityService} from '../access-control/identity.mjs';
import {createInvitationService} from '../access-control/invitations.mjs';
import {createMatchStore, syntheticMatch} from '../match-store/store.mjs';
import {createAccessGateway} from './gateway.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Models one running process with in-memory accounts, invitations and game states.
 * Provisioning test accounts is an administrative-only call to `identity`.
 * @param {{clock?: () => number}} options
 */
export function createLocalTestComposition({clock = Date.now} = {}) {
  const identity = createIdentityService({clock});
  const invitations = createInvitationService({identity, clock});
  const stores = new Map();

  function getStore(matchId) {
    if (typeof matchId !== 'string' || !UUID.test(matchId)) {
      throw new TypeError('Identificador de partida inválido');
    }
    let store = stores.get(matchId);
    if (!store) {
      const initial = syntheticMatch();
      initial.matchId = matchId;
      store = createMatchStore({snapshot: initial});
      stores.set(matchId, store);
    }
    return store;
  }

  function createServer() {
    return createAccessGateway({identity, invitations, getStore});
  }

  return Object.freeze({identity, invitations, getStore, createServer});
}
