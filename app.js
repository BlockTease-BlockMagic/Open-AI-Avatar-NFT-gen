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

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const JWT = process.env.PINATA_JWT;

async function generateImage() {
    try {
        const prompt = "Create a new avatar image for a digital profile, themed around 'Simp Tease'. The avatar should exude charm and a sense of fun, featuring a sly smirk and twinkling eyes. The style should be lively and cartoonish, with playful and exaggerated features to emphasize its spirited nature. The background should be a gradient of pink and purple, creating a vibrant and playful atmosphere. The avatar should wear stylish, modern clothing and be gender-neutral, designed to appeal to a diverse audience";
        const response = await openai.images.generate({
            model: "dall-e-3",
            prompt: prompt,
            n: 1
        });

        const imageUrl = response.data[0].url;
        console.log(imageUrl)
        return imageUrl;
    } catch (error) {
        console.error("Error generating image with OpenAI: ", error);
        throw error;
    }
}

async function downloadImage(url, path) {
    const writer = fs.createWriteStream(path);
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream'
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
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

    const pinataResponse = await pinFileToIPFS(metadataPath, 'NFT Metadata');
    return `https://ipfs.io/ipfs/${pinataResponse.IpfsHash}`;
}

app.post('/avatar-nft-openAI', async (req, res) => {
    const { name, description } = req.body;
    if ( !name || !description) {
        return res.status(400).send({ success: false, message: "Missing required fields: name, description" });
    }

    try {
        const imageUrl = await generateImage();
        const imageFilePath = path.join(__dirname, 'generated_image.png');
        await downloadImage(imageUrl, imageFilePath);

        const imagePinataResponse = await pinFileToIPFS(imageFilePath, 'Generated Image');
        const imageIPFSUrl = `https://ipfs.io/ipfs/${imagePinataResponse.IpfsHash}`;

        const attributes = [
            { trait_type: "Category", value: "Art" },
            { trait_type: "Style", value: "Generated" },
            { trait_type: "Model", value: "Open-AI-dalle-3" },
            
        ];

        const metadataHash = await createNFTMetadata(imageIPFSUrl, name, description, attributes);
        res.status(200).send({
            success: true,
            message: "Image generated, pinned, and metadata created successfully",
            imageIPFSUrl: imageIPFSUrl,
            metadataIPFSHash: metadataHash
        });
    } catch (err) {
        console.error(err);
        res.status(500).send({ success: false, error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
