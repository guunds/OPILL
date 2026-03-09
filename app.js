

// CHANGE THIS CONTRACT ADDRESS
const contractAddress = "YOUR_NFT_CONTRACT_ADDRESS";

// BASIC ABI (mint function)
const abi = [
"function mint(uint256 amount) public"
];

let provider;
let signer;
let contract;

const connectButton = document.getElementById("connectButton");
const mintButton = document.getElementById("mintButton");
const walletText = document.getElementById("walletAddress");
const statusText = document.getElementById("status");

connectButton.onclick = async () => {

if(typeof window.ethereum === "undefined"){
alert("Install MetaMask");
return;
}

provider = new ethers.providers.Web3Provider(window.ethereum);
await provider.send("eth_requestAccounts", []);

signer = provider.getSigner();
const address = await signer.getAddress();

walletText.innerText = "Wallet: " + address;

contract = new ethers.Contract(contractAddress, abi, signer);

};

mintButton.onclick = async () => {

try{

const amount = document.getElementById("mintAmount").value;

statusText.innerText = "Minting...";

const tx = await contract.mint(amount);

await tx.wait();

statusText.innerText = "NFT Minted Successfully 🚀";

}catch(err){

console.log(err);
statusText.innerText = "Mint failed";

}

};

