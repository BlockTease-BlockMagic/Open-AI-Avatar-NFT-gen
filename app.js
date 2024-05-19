const axios = require('axios').default;
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const cors = require("cors");
const { OpenAI } = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(cors());
app.use(express.static(path.join(__dirname)));

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const JWT = process.env.PINATA_JWT;

async function generateImage() {
    try {
        const prompt = "Create a new avatar image for a digital profile, themed around 'Simp Tease'. The avatar should exude charm and a sense of fun, featuring a sly smirk and twinkling eyes. The style should be lively and cartoonish, with playful and exaggerated features to emphasize its spirited nature. The background should be a gradient of pink and purple, creating a vibrant and playful atmosphere. The avatar should wear stylish, modern clothing and be gender-neutral, designed to appeal to a diverse audience.";
        const response = await openai.images.generate({
            model: "dall-e-3",
            prompt: prompt,
            n: 1,
            response_format: "url"
        });
        return response.data[0].url;
    } catch (error) {
        console.error("Error generating image with OpenAI: ", error);
        throw error;
    }
}

async function downloadImage(url, fileName) {
    const filePath = path.join(__dirname, `${fileName}.png`);
    const writer = fs.createWriteStream(filePath);
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream'
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(filePath)); // Return the file path for further use
        writer.on('error', reject);
    });
}


async function pinFileToIPFS(filePath, fileName) {
    try {
        const formData = new FormData();
        const file = fs.createReadStream(filePath);
        formData.append("file", file);
        const pinataMetadata = JSON.stringify({ name: fileName });
        formData.append("pinataMetadata", pinataMetadata);
        const pinataOptions = JSON.stringify({ cidVersion: 0 });
        formData.append("pinataOptions", pinataOptions);
        const response = await axios.post("https://api.pinata.cloud/pinning/pinFileToIPFS", formData, {
            headers: {
                ...formData.getHeaders(),
                Authorization: `Bearer ${JWT}`
            }
        });
        return response.data;
    } catch (error) {
        console.error("Error in pinFileToIPFS: ", error);
        throw error;
    }
}

async function createNFTMetadata(imageUrl, name, description, attributes) {
    const nftMetadata = {
        name: name,
        description: description,
        image: imageUrl,
        attributes: attributes
    };
    const metadataPath = path.join(__dirname, 'nft-metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify(nftMetadata, null, 2), { flag: 'w' });
    return await pinFileToIPFS(metadataPath, 'NFT Metadata');
}

app.post('/generate-avatar-openAI', async (req, res) => {
    const { name } = req.body;
    if (!name) {
        console.log("Generate Avatar Request failed: 'name' not provided in request body");
        return res.status(400).send({ success: false, message: "Missing required 'name' in the body." });
    }

    console.log(`Generating avatar for name: ${name}`);
    try {
        const imageUrl = await generateImage();
        console.log(`Avatar image URL received: ${imageUrl}`);
        const filePath = await downloadImage(imageUrl, name);
        console.log(`Image downloaded and saved at: ${filePath}`);
        res.status(200).send({
            success: true,
            message: "Image generated and saved successfully.",
            filePath: filePath,
        });
    } catch (err) {
        console.error("Error generating or saving image:", err);
        res.status(500).send({ success: false, error: err.message });
    }
});


app.post('/create-nft-pin-metadata', async (req, res) => {
    const { name, description } = req.body;
    if (!name || !description) {
        console.log("Create NFT Metadata Request failed: Missing required fields");
        return res.status(400).send({ success: false, message: "Missing required fields: name or description." });
    }

    console.log(`Creating NFT metadata for: ${name}`);
    const filePath = path.join(__dirname, `${name}.png`);
    if (!fs.existsSync(filePath)) {
        console.log(`File not found at path: ${filePath}`);
        return res.status(404).send({ success: false, message: "Image file not found. Ensure the file path is correct." });
    }

    try {
        console.log(`Pinning image to IPFS for: ${name}`);
        const imagePinataResponse = await pinFileToIPFS(filePath, 'Generated Image');
        const imageIPFSUrl = `https://ipfs.io/ipfs/${imagePinataResponse.IpfsHash}`;
        console.log(`Image pinned at URL: ${imageIPFSUrl}`);

        const attributes = [
            { trait_type: "Category", value: "Art" },
            { trait_type: "Style", value: "Generated" },
            { trait_type: "Model", value: "Open-AI-dalle-3" }
        ];

        console.log(`Creating metadata JSON for: ${name}`);
        const metadataPinataResponse = await createNFTMetadata(imageIPFSUrl, name, description, attributes);
        const metadataIPFSUrl = `https://ipfs.io/ipfs/${metadataPinataResponse.IpfsHash}`;
        console.log(`Metadata pinned at URL: ${metadataIPFSUrl}`);

        res.status(200).send({
            success: true,
            message: "Image and metadata successfully pinned to IPFS.",
            imageIPFSUrl: imageIPFSUrl,
            metadataIPFSUrl: metadataIPFSUrl
        });
    } catch (err) {
        console.error("Error in /create-nft-pin-metadata:", err);
        res.status(500).send({ success: false, error: err.message });
    }
});


app.post('/server-storage-clean', async (req, res) => {
    const { name } = req.body;
    if (!name) {
        console.log("Server Storage Clean Request failed: 'name' not provided");
        return res.status(400).send({ success: false, message: "Missing required fields: name." });
    }

    console.log(`Attempting to delete image file for: ${name}`);
    const filePath = path.join(__dirname, `${name}.png`);
    if (!fs.existsSync(filePath)) {
        console.log(`No file to delete at path: ${filePath}`);
        return res.status(404).send({ success: false, message: "Image file not found. Ensure the file path is correct." });
    }

    try {
        fs.unlink(filePath, (err) => {
            if (err) {
                console.error(`Failed to delete local image file: ${filePath}`, err);
                res.status(500).send({ success: false, error: "Failed to delete file" });
            } else {
                console.log(`Successfully deleted local image file: ${filePath}`);
                res.status(200).send({ success: true, message: "Image Successfully removed." });
            }
        });
    } catch (err) {
        console.error("Error in /server-storage-clean:", err);
        res.status(500).send({ success: false, error: err.message });
    }
});




app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
