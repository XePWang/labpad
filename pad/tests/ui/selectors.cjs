function topic(page){
 const trigger=page.getByRole('combobox',{name:'题号',exact:true});
 return {
  selectOption:async value=>{await trigger.click();const label=value==='@new:problem'?'＋ 新建题号…':value||'<无>';await page.getByRole('option').filter({has:page.getByText(label,{exact:true})}).click();},
  inputValue:()=>trigger.getAttribute('data-value'),isDisabled:()=>trigger.isDisabled(),boundingBox:()=>trigger.boundingBox()
 };
}
module.exports={topic};
