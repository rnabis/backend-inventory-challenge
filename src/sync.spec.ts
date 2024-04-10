import {
  findChangesBetweenDatasets,
  findDeltas,
  getDeltas, makeUpdates,
  skuBatchToInserts,
} from './sync';
import { skuBatchUpdate } from "./interfaces.util";

describe('sync', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('.skuBatchToInserts', () => {
    it('should return a list of inserts', async () => {
      const data = [
        {
          skuBatchId: 'sku-batch-id-1',
          skuId: 'sku-id-1',
          quantityPerUnitOfMeasure: 25,
        },
        {
          skuBatchId: 'sku-batch-id-2',
          skuId: 'sku-id-1',
          quantityPerUnitOfMeasure: 25,
        },
        {
          skuBatchId: 'sku-batch-id-3',
          skuId: 'sku-id-2',
          quantityPerUnitOfMeasure: 1,
        },
      ];
  
      await expect(
        skuBatchToInserts(
          data.map((d) => d.skuBatchId),
        ),
      ).resolves.toStrictEqual([
        "insert into test_table (col_1, col_2) values ('sku-id-1', 'sku-batch-id-1')",
        "insert into test_table (col_1, col_2) values ('sku-id-1', 'sku-batch-id-1')",
        "insert into test_table (col_1, col_2) values ('sku-id-1', 'sku-batch-id-1')",
        "insert into test_table (col_1, col_2) values ('sku-id-1', 'sku-batch-id-1')",
        "insert into test_table (col_1, col_2) values ('sku-id-1', 'sku-batch-id-2')",
        "insert into test_table (col_1, col_2) values ('sku-id-1', 'sku-batch-id-2')",
        "insert into test_table (col_1, col_2) values ('sku-id-1', 'sku-batch-id-2')",
        "insert into test_table (col_1, col_2) values ('sku-id-1', 'sku-batch-id-2')",
        "insert into test_table (col_1, col_2) values ('sku-id-1', 'sku-batch-id-3')",
        "insert into test_table (col_1, col_2) values ('sku-id-1', 'sku-batch-id-3')",
        "insert into test_table (col_1, col_2) values ('sku-id-1', 'sku-batch-id-3')",
        "insert into test_table (col_1, col_2) values ('sku-id-1', 'sku-batch-id-3')"
      ]);
    });
  });

  describe('.getDeltas', () => {
    it('should find deltas', async () => {
      // example of the data below:
      // skuBatchIds = ['sku-batch-id-1', 'sku-batch-id-2', 'sku-batch-id-3', 'sku-batch-id-4'];
      // appSkuBatchIds = [...skuBatchIds, 'sku-batch-id-5', 'sku-batch-id-6']; // 5 and 6 are new
      await expect(getDeltas()).resolves.toStrictEqual(['sku-batch-id-5', 'sku-batch-id-6']);
    });
  });

  describe('.findDeltas', () => {
    it('should pick up changes to quantityPerUnitOfMeasure', () => {
      // Step 1: Prepare the test data
      const appSkuBatchData = [{
        skuBatchId: '1',
        skuId: 'sku1',
        wmsId: 'wms1',
        quantityPerUnitOfMeasure: 10, // Different from inventory
        isArchived: false,
        isDeleted: false,
      }];
  
      const inventorySkuBatchData = [{
        skuBatchId: '1',
        skuId: 'sku1',
        wmsId: 'wms1',
        quantityPerUnitOfMeasure: 5, // Different from app
        isArchived: false,
        isDeleted: false,
      }];
  
      // Step 2: Call findDeltas function
      const deltas = findDeltas(appSkuBatchData, inventorySkuBatchData);
  
      // Step 3: Assert expected behavior
      expect(deltas.length).toBe(1); // Expect one delta due to quantityPerUnitOfMeasure change
      expect(deltas[0].skuBatchId).toBe('1'); // Confirm the skuBatchId is correct
      expect(deltas[0].updates).toEqual(expect.arrayContaining([
        expect.objectContaining({
          field: 'quantityPerUnitOfMeasure',
          newValue: 10 // The new value from appSkuBatchData
        })
      ]));
    });

    it('should not change the skuId if already set', async () => {
      const appData = [{ skuBatchId: '1', skuId: 'existing-sku', wmsId: '1', isArchived: false, isDeleted: false, quantityPerUnitOfMeasure: 0 }];
      const inventoryData = [{ skuBatchId: '1', skuId: 'new-sku', wmsId: '1', isArchived: false, isDeleted: false, quantityPerUnitOfMeasure: 0 }];
  
      const deltas = findDeltas(appData, inventoryData);
      expect(deltas.find(delta => delta.updates.find(u => u.field === 'skuId'))).toBeUndefined();
    });
  
    it('should pick up change to skuId if not set', () => {
      // Step 1: Define test data
      const appSkuBatchData = [{
        skuBatchId: '1',
        skuId: null, // skuId not set in app data
        wmsId: 'wms1',
        quantityPerUnitOfMeasure: 5,
        isArchived: false,
        isDeleted: false,
      }];
  
      const inventorySkuBatchData = [{
        skuBatchId: '1',
        skuId: 'sku123', // skuId is set in inventory data
        wmsId: 'wms1',
        quantityPerUnitOfMeasure: 5,
        isArchived: false,
        isDeleted: false,
      }];
  
      // Step 2: Invoke findDeltas function
      const deltas = findDeltas(appSkuBatchData, inventorySkuBatchData);
  
      // Step 3: Assert expected behavior
      expect(deltas.length).toBe(1); // Expect one delta due to the skuId change
      const skuIdUpdate = deltas[0].updates.find(update => update.field === 'skuId');
      expect(skuIdUpdate).toBeDefined();
      expect(skuIdUpdate?.newValue).toBe('sku123'); // The new skuId value should come from inventory data
    });

    it('should pick up change to wmsId', () => {
      // Define test data with different wmsId values between app and inventory
      const appSkuBatchData = [{
        skuBatchId: '1',
        skuId: 'sku1',
        wmsId: 'wms-app', // Different wmsId in app data
        quantityPerUnitOfMeasure: 100,
        isArchived: false,
        isDeleted: false,
      }];
  
      const inventorySkuBatchData = [{
        skuBatchId: '1',
        skuId: 'sku1',
        wmsId: 'wms-inventory', // Different wmsId in inventory data
        quantityPerUnitOfMeasure: 100,
        isArchived: false,
        isDeleted: false,
      }];
  
      // Call findDeltas function with the test data
      const deltas = findDeltas(appSkuBatchData, inventorySkuBatchData);
  
      // Assert that a delta was found
      expect(deltas.length).toBe(1);
      expect(deltas[0].updates).toEqual(expect.arrayContaining([
        expect.objectContaining({
          field: 'wmsId',
          newValue: 'wms-app' // Expecting the newValue to be from the app data
        })
      ]));
    });

      it('should find changes between datasets', () => {
        // Define test data simulating differences in wmsId, skuId, and quantityPerUnitOfMeasure
        const appSkuBatchData = [{
          skuBatchId: '1',
          skuId: null, // Not set in app, set in inventory
          wmsId: 'wms-app-diff', // Different in app
          quantityPerUnitOfMeasure: 10, // Different in app
          isArchived: false,
          isDeleted: false,
        }];
    
        const inventorySkuBatchData = [{
          skuBatchId: '1',
          skuId: 'sku123', // Set in inventory
          wmsId: 'wms-inventory-diff', // Different in inventory
          quantityPerUnitOfMeasure: 5, // Different in inventory
          isArchived: false,
          isDeleted: false,
        }];
    
        // Call findDeltas function with the test data
        const deltas = findDeltas(appSkuBatchData, inventorySkuBatchData);
    
        // Assert that the function detects the changes and constructs updates correctly
        expect(deltas.length).toBe(1);
        const updates = deltas[0].updates;
    
        // Check for specific updates
        expect(updates).toEqual(expect.arrayContaining([
          expect.objectContaining({
            field: 'skuId',
            newValue: 'sku123'
          }),
          expect.objectContaining({
            field: 'wmsId',
            newValue: 'wms-app-diff'
          }),
          expect.objectContaining({
            field: 'quantityPerUnitOfMeasure',
            newValue: 10
          })
        ]));
    
        // Optionally, verify no updates for fields that didn't change
        expect(updates).not.toContainEqual(expect.objectContaining({
          field: 'isArchived',
          newValue: expect.anything()
        }));
        expect(updates).not.toContainEqual(expect.objectContaining({
          field: 'isDeleted',
          newValue: expect.anything()
        }));
      });
  });

  describe('.makeUpdates', () => {
    it('should create a list of string sql updates based on an update delta', async () => {
      const delta: skuBatchUpdate = {
        skuBatchId: '1',
        updates: [
          {
            field: 'quantityPerUnitOfMeasure',
            newValue: 10,
          },
          {
            field: 'isArchived',
            newValue: true,
          },
        ],
      };
    
      const expectedSqlUpdates = [
        "update inventory set quantity_per_unit_of_measure = 10 where sku_batch_id = '1'",
        "update inventory set is_archived = TRUE where sku_batch_id = '1'",
      ];
    
      const result = await makeUpdates(delta);
      expect(result).toStrictEqual(expectedSqlUpdates);
    });
  });
});