import { snakeCase } from 'lodash';
import {
  WMSWarehouseMeta,
  inventoryUpdate,
  RecordWithWMS,
  SkuBatchData,
  SkuBatchToSkuId,
  skuBatchUpdate,
} from './interfaces.util';
import {
    appData,
    appSkuBatchData, appSkuBatchDataForSkuBatchIds,
    skuBatchIdsFromInventoryDb,
    skuBatchIdsFromAppDb,
    warehouseData
} from "./db/data";
import {
    getUpdateForSkuBatchRecord,
    insertify,
    queryExec,
    formatSqlValue,
} from "./db/sql.util";

const logger = console;

/**
 * Create a list of records for a skuBatch record that maps skuBatchId + warehouseId
 * @param skuBatchRecord
 */
const makeWarehouseRecordsForSkuBatchRecord = (skuBatchRecord: SkuBatchToSkuId): RecordWithWMS[] => {
  return warehouseData.map(
    (warehouse: WMSWarehouseMeta): RecordWithWMS => ({
        skuBatchId: skuBatchRecord.skuBatchId,
        skuId: skuBatchRecord.skuId,
        wmsId: skuBatchRecord.wmsId,
        quantityPerUnitOfMeasure: skuBatchRecord.quantityPerUnitOfMeasure ?? 1,
        isArchived: skuBatchRecord.isArchived,
        isDeleted: skuBatchRecord.isDeleted,
        warehouseId: warehouse.warehouseId,
      }),
  );
};

/**
 * Converts a list of skuBatchIds from the app db into an insert to inventory.
 * @param skuBatchIdsToInsert
 */
export async function skuBatchToInserts(skuBatchIdsToInsert: string[]): Promise<string[]> {
  const badSkuBatchCounter = { count: 0 };

  // create our inserts
  const inserts: string[] = skuBatchIdsToInsert
    .reduce((arr: RecordWithWMS[], skuBatchId: string): RecordWithWMS[] => {
      const skuBatchRecordFromAppDb: SkuBatchToSkuId | undefined = appData.find(
        (skuBatchToSkuId: SkuBatchToSkuId): boolean => skuBatchToSkuId.skuBatchId === skuBatchId,
      );

      if (!skuBatchRecordFromAppDb) {
        logger.error(`no records found in app SkuBatch [skuBatchId=${skuBatchId}}]`);
        badSkuBatchCounter.count += 1;
        return arr;
      }

      arr.push(...makeWarehouseRecordsForSkuBatchRecord(skuBatchRecordFromAppDb));
      return arr;
    }, [])
    .map(insertify);

  logger.log(`created inserts [count=${inserts.length}, badSkuBatchRecordCount=${badSkuBatchCounter.count}]`);

  return inserts;
}

/**
 * Diffs the inventory between app SkuBatch and inventory to determine
 * what we need to copy over.
 */
export async function getDeltas(): Promise<string[]> {
  try {
    const inventorySkuBatchIds: Set<string> = new Set<string>(skuBatchIdsFromInventoryDb.map((r) => r.skuBatchId));
    // This should filter for skuBatchIds present in the application data but NOT in the inventory data.
    return [...new Set<string>(skuBatchIdsFromAppDb.map((r) => r.id))]
        .filter((appId: string) => !inventorySkuBatchIds.has(appId)); // Corrected to check for absence
  } catch (err) {
    logger.error('error querying databases for skuBatchIds');
    logger.error(err);
    throw err;
  }
}

/**
 * Builds list of SQL updates - this is a pretty simple function to turn a delta
 * into a SQL update
 * @param delta
 */
export const makeUpdates = (delta: skuBatchUpdate): Promise<string[]> => {
  // Map each update in the delta to a SQL statement
  const updatesToMake = delta.updates.map(update => {
    // Convert the field name to snake_case
    const fieldName = snakeCase(update.field);
    // Format the new value for SQL insertion
    const value = formatSqlValue(update.newValue);
    // Create and return the SQL update statement for the inventory table
    return getUpdateForSkuBatchRecord('inventory', `${fieldName} = ${value}`, delta.skuBatchId);
  });

  // Wrap the synchronous result in a Promise
  return Promise.resolve(updatesToMake);
};

/**
 * Finds the deltas between two lists of SkuBatchData
 * @param appSkuBatchData
 * @param inventorySkuBatchData
 */

export const findDeltas = (
  appSkuBatchData: SkuBatchData[],
  inventorySkuBatchData: SkuBatchData[],
): skuBatchUpdate[] => {
  return appSkuBatchData
    .map((appSbd: SkuBatchData) => {
      const inventoryRecord: SkuBatchData | undefined = inventorySkuBatchData
          .find((inventorySbd: SkuBatchData) => inventorySbd.skuBatchId === appSbd.skuBatchId);
      if (!inventoryRecord) {
        logger.warn(`cannot find matching inventory record! [skuBatchId=${appSbd.skuBatchId}]`);
        return { skuBatchId: '', updates: [] };
      }

      const updates: inventoryUpdate[] = Object.keys(appSbd)
        .filter((key: string) => !['skuBatchId', 'isArchived', 'isDeleted'].includes(key))
        .reduce((recordUpdates: inventoryUpdate[], key: string) => {
          const inventoryValue = inventoryRecord[key as keyof SkuBatchData];
          const appValue = appSbd[key as keyof SkuBatchData];

          // Corrected logic for skuId handling
          if (key === 'skuId') {
              if (appValue === null && inventoryValue !== null) {
                  recordUpdates.push({ field: key, newValue: inventoryValue });
              }
              // Skip updating skuId if it's already set in appSbd, hence no else block here
          } else if (inventoryValue !== appValue) {
              recordUpdates.push({ field: key, newValue: appValue });
          }

          return recordUpdates;
        }, []);

      return updates.length > 0 ? { skuBatchId: inventoryRecord.skuBatchId, updates } : null;
    })
    .filter((update): update is skuBatchUpdate => update !== null);
};

/**
 * Finds changes in data between the app SkuBatch+Sku and inventory tables
 */
export async function findChangesBetweenDatasets(): Promise<string[]> {
  logger.log('finding app SkuBatch data that has changed and <> the inventory data');

  const updates: string[] = await [appSkuBatchData].reduce(async (accumPromise, inventorySkuBatchData) => {
    const accum = await accumPromise; // Ensure we're working with the accumulated array
    const skuBatchIds = inventorySkuBatchData.map(sbd => sbd.skuBatchId);

    logger.log(`querying Logistics.SkuBatch for data [skuBatchIdCount=${skuBatchIds.length}]`);
    // Fetch SkuBatch+Sku data from the app database
    const appSkuBatchData = await appSkuBatchDataForSkuBatchIds; // Assuming this fetch is correct and returns SkuBatchData[]

    // If we have a count mismatch, log a warning
    if (appSkuBatchData.length != inventorySkuBatchData.length) {
      const appSkuBatchIds = appSkuBatchData.map(sbd => sbd.skuBatchId);
      const missingIds = skuBatchIds.filter(id => !appSkuBatchIds.includes(id));
      if (missingIds.length > 0) {
        logger.warn(`Missing SKU Batch IDs from app data: [${missingIds.join(', ')}]`);
      }
    }

    // Push our new sql updates into the accumulator list
    for (const delta of findDeltas(appSkuBatchData, inventorySkuBatchData)) {
      const updateStatements = await makeUpdates(delta); // makeUpdates should be awaited here
      accum.push(...updateStatements); // Concatenate the resolved promises' results
    }

    return accum; // Return the updated accumulator
  }, Promise.resolve([] as string[])); // Initial accumulator is a resolved promise of an empty array
  
  logger.log(`built updates [count=${updates.length}]`);
  return updates;
}

/**
 * Updates inventory data from app SkuBatch and Sku
 */
export async function copyMissingInventoryRecordsFromSkuBatch(): Promise<void | Error> {
  logger.log('copying missing inventory records from app Sku/SkuBatch');

  // find out what skuBatchIds don't exist in inventory
  const skuBatchIdsToInsert: string[] = await getDeltas();
  logger.log(`copying new skuBatch records... [skuBatchCount=${skuBatchIdsToInsert.length}]`);
  try {
    const inserts = await skuBatchToInserts(skuBatchIdsToInsert);
    await queryExec({}, inserts);
  } catch (err) {
    logger.error(err);
    throw err;
  }

  logger.log('done updating additive data to inventory from app db');
}

/**
 * Pulls inventory and SkuBatch data and finds changes in SkuBatch data
 * that are not in the inventory data.
 */
export async function updateInventoryDeltasFromSkuBatch(): Promise<void> {
  logger.log('updating inventory from deltas in "SkuBatch" data');

  try {
    const sqlUpdates: string[] = await findChangesBetweenDatasets();
    await queryExec({}, sqlUpdates);
  } catch (err) {
    logger.error(err);
    throw err;
  }

  logger.log('done updating inventory from deltas from app db');
}

/**
 * Primary entry point to sync SkuBatch data from the app
 * database over to the inventory database
 */
export async function sync(): Promise<void | Error> {
  try {
    await copyMissingInventoryRecordsFromSkuBatch();
    await updateInventoryDeltasFromSkuBatch();
  } catch (err) {
    logger.error('error syncing skuBatch data');
    return Promise.reject(err);
  }
}