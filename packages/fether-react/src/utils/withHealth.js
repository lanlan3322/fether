// Copyright 2015-2018 Parity Technologies (UK) Ltd.
// This file is part of Parity.
//
// SPDX-License-Identifier: BSD-3-Clause

import BigNumber from 'bignumber.js';
import { combineLatest, Observable, of, fromEvent, merge } from 'rxjs';
import { compose, mapPropsStream } from 'recompose';
import {
  delay,
  distinctUntilChanged,
  filter,
  map,
  publishReplay,
  startWith,
  switchMap,
  take,
  tap
} from 'rxjs/operators';
import isElectron from 'is-electron';
import isEqual from 'lodash/isEqual';
import { peerCount$, syncStatus$, withoutLoading } from '@parity/light.js';

import parityStore from '../stores/parityStore';

const electron = isElectron() ? window.require('electron') : null;

// List here all possible states of our health store. Each state can have a
// payload.
export const STATUS = {
  CLOCKNOTSYNC: Symbol('CLOCKNOTSYNC'), // Local clock is not sync
  DOWNLOADING: Symbol('DOWNLOADING'), // Currently downloading Parity
  GOOD: Symbol('GOOD'), // Everything's fine
  NOINTERNET: Symbol('NOINTERNET'), // No Internet connection
  NOPEERS: Symbol('NOPEERS'), // Not connected to any peers
  LAUNCHING: Symbol('LAUNCHING'), // Parity is being launched (only happens at startup)
  SYNCING: Symbol('SYNCING') // Obvious
};

const isApiConnected$ = parityStore.isApiConnected$;

const isParityRunning$ = Observable.create(observer => {
  if (electron) {
    electron.ipcRenderer.on('parity-running', (_, isParityRunning) => {
      observer.next(isParityRunning);
    });
  }
}).pipe(
  startWith(electron ? !!electron.remote.getGlobal('isParityRunning') : false)
);

const downloadProgress$ = Observable.create(observer => {
  if (electron) {
    electron.ipcRenderer.on('parity-download-progress', (_, progress) => {
      observer.next(progress);
    });
  }
}).pipe(startWith(0));

const isClockSync$ = Observable.create(observer => {
  if (electron) {
    electron.ipcRenderer.send('asynchronous-message', 'check-clock-sync');
    electron.ipcRenderer.once('check-clock-sync-reply', (_, clockSync) => {
      observer.next(clockSync.isClockSync);
    });
  }
}).pipe(startWith(true));

const online$ = merge(
  fromEvent(window, 'online').pipe(map(() => true)),
  fromEvent(window, 'offline').pipe(map(() => false))
).pipe(startWith(navigator.onLine));

const combined$ = combineLatest(
  isParityRunning$,
  isApiConnected$,
  downloadProgress$,
  online$,
  isClockSync$
).pipe(publishReplay(1));
combined$.connect();

// Subscribe to the RPCs only once we set a provider
const rpcs$ = isApiConnected$.pipe(
  filter(isApiConnected => isApiConnected),
  take(1),
  switchMap(() =>
    combineLatest(
      syncStatus$().pipe(
        map(syncStatus => {
          if (!syncStatus) {
            return {
              isSync: true
            };
          }

          const { currentBlock, highestBlock, startingBlock } = syncStatus;
          const percentage = currentBlock
            .minus(startingBlock)
            .multipliedBy(100)
            .div(highestBlock.minus(startingBlock));

          return {
            isSync: false,
            syncPayload: {
              currentBlock,
              highestBlock,
              percentage,
              startingBlock
            }
          };
        }),
        // Emit "not synced" only if we haven't been synced for over 2 seconds,
        // as syncing to new blocks from the top of the chain usually takes ~1s.
        // syncStatus$() is distinctUntilChanged, so {isSync: false} will never
        // be fired twice in a row.
        switchMap(sync => (sync.isSync ? of(sync) : of(sync).pipe(delay(2000))))
      ),
      peerCount$().pipe(withoutLoading())
    )
  ),
  startWith([{ isSync: false }, undefined]), // Don't stall the HOC's combineLatest; emit immediately
  publishReplay(1)
);
rpcs$.connect();

// Inject node health information as health.{status, payload} props
export default compose(
  mapPropsStream(props$ =>
    combineLatest(props$, combined$, rpcs$).pipe(
      map(
        ([
          props,
          [
            isParityRunning,
            isApiConnected,
            downloadProgress,
            online,
            isClockSync
          ],
          [{ isSync, syncPayload }, peerCount]
        ]) => {
          // No connexion to the internet
          if (!online) {
            return {
              ...props,
              health: {
                status: STATUS.NOINTERNET
              }
            };
          }

          // Parity is being downloaded
          if (downloadProgress > 0 && !isParityRunning) {
            return {
              ...props,
              health: {
                status: STATUS.DOWNLOADING,
                payload: {
                  percentage: new BigNumber(Math.round(downloadProgress * 100))
                }
              }
            };
          }

          // Parity is being launched
          if (!isApiConnected) {
            return {
              ...props,
              health: {
                status: STATUS.LAUNCHING
              }
            };
          }

          // At this point we have a successful connection to parity

          // Clock is not synchronized
          if (!isClockSync) {
            return {
              ...props,
              health: {
                status: STATUS.CLOCKNOTSYNC
              }
            };
          }

          // Not enough peers
          if (peerCount === undefined || peerCount.lte(1)) {
            return {
              ...props,
              health: {
                status: STATUS.NOPEERS
              }
            };
          }

          // Syncing blocks
          if (!isSync) {
            console.log('-------------------');
            console.log('withHealth.js - DURING .map \n');
            console.log('SYNCING with:');
            console.log('  isParityRunning: ', isParityRunning);
            console.log('  isApiConnected: ', isApiConnected);
            console.log('  props.require (connected?): ', props.require);
            console.log('  downloadProgress: ', downloadProgress);
            console.log('  online: ', online);
            console.log('  isClockSync: ', isClockSync);
            console.log('  isSync: ', isSync);
            console.log('  syncPayload: ', syncPayload);
            console.log(
              '    current block',
              syncPayload && syncPayload.currentBlock.toString()
            );
            console.log(
              '    highest block',
              syncPayload && syncPayload.highestBlock.toString()
            );
            console.log(
              '    percentage',
              syncPayload && syncPayload.percentage.toString()
            );
            console.log(
              '    starting block',
              syncPayload && syncPayload.startingBlock.toString()
            );
            console.log('  props.health');
            console.log('    sync status', props.health && props.health.status);
            console.log(
              '    current block',
              props.health &&
                props.health.payload &&
                props.health.payload.currentBlock.toString()
            );
            console.log(
              '    highest block',
              props.health &&
                props.health.payload &&
                props.health.payload.highestBlock.toString()
            );
            console.log(
              '    percentage',
              props.health &&
                props.health.payload &&
                props.health.payload.percentage.toString()
            );
            console.log(
              '    starting block',
              props.health &&
                props.health.payload &&
                props.health.payload.startingBlock.toString()
            );
            console.log('  peerCount: ', peerCount.toString());

            return {
              ...props,
              health: {
                status: STATUS.SYNCING,
                payload: syncPayload
              }
            };
          }

          console.log('-------------------');
          console.log('withHealth.js - DURING .map \n');
          console.log('GOOD with:');
          console.log('  isParityRunning: ', isParityRunning);
          console.log('  isApiConnected: ', isApiConnected);
          console.log('  props.require (connected?): ', props.require);
          console.log('  downloadProgress: ', downloadProgress);
          console.log('  online: ', online);
          console.log('  isClockSync: ', isClockSync);
          console.log('  isSync: ', isSync);
          console.log('  syncPayload: ', syncPayload);
          console.log(
            '    current block',
            syncPayload && syncPayload.currentBlock.toString()
          );
          console.log(
            '    highest block',
            syncPayload && syncPayload.highestBlock.toString()
          );
          console.log(
            '    percentage',
            syncPayload && syncPayload.percentage.toString()
          );
          console.log(
            '    starting block',
            syncPayload && syncPayload.startingBlock.toString()
          );
          console.log('  props.health');
          console.log('    sync status', props.health && props.health.status);
          console.log(
            '    current block',
            props.health &&
              props.health.payload &&
              props.health.payload.currentBlock.toString()
          );
          console.log(
            '    highest block',
            props.health &&
              props.health.payload &&
              props.health.payload.highestBlock.toString()
          );
          console.log(
            '    percentage',
            props.health &&
              props.health.payload &&
              props.health.payload.percentage.toString()
          );
          console.log(
            '    starting block',
            props.health &&
              props.health.payload &&
              props.health.payload.startingBlock.toString()
          );
          console.log('  peerCount: ', peerCount.toString());

          // Everything's OK
          return {
            ...props,
            health: {
              status: STATUS.GOOD
            }
          };
        }
      ),
      tap(props => {
        console.log('---------------');
        console.log('withHeath.js - AFTER .map \n');
        console.log('  props', props);
      }),
      distinctUntilChanged(isEqual) // Perform deep comparison,
    )
  )
);
