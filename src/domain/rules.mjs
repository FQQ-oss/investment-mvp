export const stockRules = {
  SSE_MAIN: { market: 'SSE', board: '沪市主板', buyLot: 100, limitPct: 10, maxOrder: 1000000 },
  SZSE_MAIN: { market: 'SZSE', board: '深市主板', buyLot: 100, limitPct: 10, maxOrder: 1000000 },
  CHINEXT: { market: 'SZSE', board: '创业板', buyLot: 100, limitPct: 20, maxOrder: 1000000 },
  STAR: { market: 'SSE', board: '科创板', buyLot: 200, limitPct: 20, maxOrder: 1000000 },
  BSE: { market: 'BSE', board: '北交所', buyLot: 100, limitPct: 30, maxOrder: 1000000 },
};

export function classifyStock(symbol) {
  const code = String(symbol || '').trim().toUpperCase();
  if (/^68/.test(code)) return { ...stockRules.STAR, instrumentType: 'stock', status: 'normal', symbol: code };
  if (/^30/.test(code)) return { ...stockRules.CHINEXT, instrumentType: 'stock', status: 'normal', symbol: code };
  if (/^(8|4)/.test(code)) return { ...stockRules.BSE, instrumentType: 'stock', status: 'normal', symbol: code };
  if (/^6/.test(code)) return { ...stockRules.SSE_MAIN, instrumentType: 'stock', status: 'normal', symbol: code };
  return { ...stockRules.SZSE_MAIN, instrumentType: 'stock', status: 'normal', symbol: code };
}

export function validateStockOrder({ symbol, side, quantity, price, previousClose }) {
  const asset = classifyStock(symbol);
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > asset.maxOrder) throw new Error('申报数量必须是正整数且不超过单笔上限');
  if (side === 'buy' && quantity % asset.buyLot !== 0) throw new Error(`${asset.board}买入数量必须是${asset.buyLot}股整数倍`);
  if (price <= 0 || Math.round(price * 100) !== price * 100) throw new Error('股票价格最小变动单位为0.01元');
  if (previousClose > 0 && Math.abs(price / previousClose - 1) > asset.limitPct / 100 + 0.001) throw new Error(`${asset.board}委托价格超过${asset.limitPct}%涨跌幅范围`);
  return asset;
}
