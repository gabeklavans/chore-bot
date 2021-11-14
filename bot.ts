import dotenv from "dotenv";
dotenv.config();
import { Bot } from "grammy";
import { StatelessQuestion } from "@grammyjs/stateless-question";
import { PrismaClient } from "@prisma/client";
import { User } from "@grammyjs/types";
import {} from "node-schedule";

const prisma = new PrismaClient();

const bot = new Bot(process.env.BOT_API_KEY as string);

const parseChoreName = (messageText: String) => {
	const tokens = messageText.split(" ");
	if (tokens.length < 2) {
		return undefined;
	}
	return tokens[1];
};

const queryChoreName = new StatelessQuestion("choreName", async (ctx) => {
	const name = ctx.message.text;

	if (!name) {
		ctx.reply("Please enter a valid name!");
	} else if (/\s/.test(name)) {
		ctx.reply("A name cannot contain any whitespaces");
	} else {
		const chore = await prisma.chore.create({
			data: {
				name: name as string,
			},
		});
		console.log(chore);

		ctx.reply(`Created chore: "${chore.name}"`);
	}
});

const queryUsers = new StatelessQuestion("usersList", async (ctx) => {
	if (ctx.message.entities) {
		const chore = await prisma.chore.findFirst({
			where: { id: "6190a4578190340c57d3de00" },
		});

		const tgUsers: User[] = ctx.message.entities
			.filter((entity) => entity.type === "text_mention")
			.map((entity: any) => entity.user)
			.filter((user: User) => !user.is_bot);

		const users = tgUsers.map((users) => {
			return {
				tgId: users.id,
				choreId: chore!.id,
			};
		});

		// Clear out whatever was there already
		await prisma.weight.deleteMany({ where: { choreId: chore!.id } });
		// Create new weight entries for the users
		const numWeights = await prisma.weight.createMany({
			data: users,
		});

		ctx.reply(`${numWeights.count} users set for "${chore!.name}"`);
	}
});

bot.use(queryChoreName);
bot.use(queryUsers);

// React to /start command
bot.command("start", (ctx) => ctx.reply("Welcome! Up and running."));

bot.command("newchore", (ctx) => {
	return queryChoreName.replyWithMarkdown(
		ctx,
		`Enter a name for the Chore, i.e. "It's Tanner's turn to do <choreName>!"`
	);
});

bot.command("setusers", (ctx) => {
	// get the chore name entered
	const choreName = parseChoreName(ctx.message!.text);
	if (!choreName) {
		return ctx.reply("Please also type the name of the chore.");
	}

	return queryUsers.replyWithMarkdown(
		ctx,
		`Mention all the users to be assigned to this chore (this will erase the existing users).`
	);
});

bot.command("due", async (ctx) => {
	const message = ctx.message!.text;

	// get the chore name entered
	const choreName = parseChoreName(message);
	if (!choreName) {
		return ctx.reply("Please also type the name of the chore that is due.");
	}

	// get list of weights and users for the chore
	const weights = await prisma.chore
		.findFirst({
			where: { name: choreName },
		})
		.weights();
	if (weights.length < 1) {
		return ctx.reply("No users assigned to this chore.");
	}

	// decide which user to assign the chore to
	const asignee = await ctx.getChatMember(weights[0].tgId);

	// ping the chat
	ctx.reply(
		`It's time for [${asignee.user.first_name}](tg://user?id=${asignee.user.id}) to do ${choreName}`,
		{ parse_mode: "MarkdownV2" }
	);
});

// bot.on("message", (ctx) => {
// 	const isMention = (ctx.message as any).entities
// 		? (ctx.message as any).entities[0].type === "mention"
// 		: undefined;

// 	if (isMention) {

// 	} else {
// 		// just a normal message
// 	}
// });

prisma.$connect().then(() => {
	console.log("DB Connected");
	console.log("Trying to start bot...");
	bot.start();
});
