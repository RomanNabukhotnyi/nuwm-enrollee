const content = new Array(8111).map(() => "d").join(); // 8111 * 'd' = 8111 characters

console.log(content.length); // 8111

const [res] = content.match(/.{1,8100}/g) || [];

console.log(res?.length); // 8100
