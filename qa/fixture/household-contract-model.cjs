// Executable specification for the PROPOSED server contract, NOT production database/RPC code.
const clone=x=>structuredClone(x);
function applyBatch(database,{householdId,actorId,deviceId,operations}){
  if(!database.members.some(m=>m.householdId===householdId&&m.actorId===actorId&&m.active))throw Error('Not an active household member');
  const next=clone(database), results=[];
  for(const op of operations){
    const receiptKey=householdId+'|'+op.operationId, digest=JSON.stringify({...op,operationId:undefined});
    const prior=next.receipts[receiptKey];
    if(prior){if(prior.digest!==digest)throw Error('Operation ID reused with a different payload');results.push(clone(prior));continue;}
    const key=householdId+'|'+op.printingId+'|'+op.finish;
    if(!['normal','foil'].includes(op.finish)||!op.printingId)throw Error('Invalid printing or finish');
    const current=next.inventory[key]||{quantity:0,revision:0};
    let quantity;
    if(op.kind==='add'){
      if(!Number.isSafeInteger(op.quantity)||op.quantity<=0)throw Error('Addition must be positive');
      quantity=current.quantity+op.quantity;
    }else if(op.kind==='set'){
      if(current.revision!==op.expectedRevision)throw Error('Revision conflict');
      quantity=op.quantity;
    }else throw Error('Unknown operation');
    if(!Number.isSafeInteger(quantity)||quantity<0)throw Error('Invalid resulting quantity');
    const value={quantity,revision:current.revision+1};next.inventory[key]=value;
    const receipt={digest,householdId,actorId,deviceId,operationId:op.operationId,...value};
    next.receipts[receiptKey]=receipt;results.push(clone(receipt));
  }
  // A real implementation must perform all membership, locks, updates and receipts in ONE DB transaction.
  return {database:next,receipts:results};
}
module.exports={applyBatch};
