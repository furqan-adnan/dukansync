export function printReceipt(width: '58mm' | '80mm' = '58mm') {
  document.body.classList.add(`print-${width}`);
  window.print();
  document.body.classList.remove(`print-${width}`);
}
