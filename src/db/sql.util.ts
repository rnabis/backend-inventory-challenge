import {RecordWithWMS} from "../interfaces.util";
import axios from 'axios';

export const insertify = (record: RecordWithWMS): string =>
  `insert into test_table (col_1, col_2) values ('${record.skuId}', '${record.skuBatchId}')`;
// fix to string literals to avoid sql injection

export const getUpdateForSkuBatchRecord = (table: string, updates: string, skuBatchId: string) =>
  `update ${table} set ${updates} where sku_batch_id = '${skuBatchId}'`;

// no op that would take our db connection and execute the list of sql statements
export const queryExec = (db: any, sql: string[]): Promise<void> => Promise.resolve();

export const formatSqlValue = (v: string | number | boolean | null): string => {
  if (v === null) {
    return 'NULL';
  }
  switch (typeof v) {
    case 'string':
      return `'${v.replace(/'/g, "''")}'`; 
    case 'boolean':
      return v ? 'TRUE' : 'FALSE';
    default:
      return v.toString();
  }
};

export const postOrUpdateInventory = async (record: RecordWithWMS): Promise<void> => {
  const url = `https://local-inventory.nabis.dev/v1/inventory`;
  const method = record.id ? 'put' : 'post';
  const data = {
    skuBatchId: record.skuBatchId,
    skuId: record.skuId,
    warehouseId: record.warehouseId
  };

  await axios({
    method,
    url,
    data
  });
};

export const postOrUpdateInventoryAggregate = async (record: RecordWithWMS): Promise<void> => {
  const url = `https://local-inventory.nabis.dev/v1/inventory-aggregate`;
  const method = record.id ? 'put' : 'post';
  const data = {
    skuBatchId: record.skuBatchId,
    skuId: record.skuId
  };

  await axios({
    method,
    url,
    data
  });
};
